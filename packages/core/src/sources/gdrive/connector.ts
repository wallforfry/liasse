import type { GdriveSourceConfig } from '@liasse/contract';
import { SourceFileChangedError, SourceFileUnavailableError } from '../../ingest/document-file.ts';
import { type SourceConnector, SourceCredentialsError } from '../connector.ts';
import type { GoogleClientReader } from '../google/client.ts';
import { type GoogleClient, GoogleAuthorizationError, type GoogleOAuth } from '../google/oauth.ts';
import { driveChanges } from './changes.ts';
import { parseDriveCursor } from './cursor.ts';
import { type DriveApi, DriveFileRefusedError, DriveUnauthorizedError } from './drive-api.ts';
import { createDriveApi } from './drive-client.ts';
import { FOLDER_TYPE } from './items.ts';

export interface DriveConnectorDeps {
  readonly oauth: GoogleOAuth;
  readonly client: GoogleClientReader;
  /** The base of the Drive API v3. */
  readonly drive: string;
}

const NO_CLIENT =
  'No Google client is saved in the settings: give its client id and secret, then connect ' +
  'the source again.';

// Google's refusals of the authorization are those of the source: polling stops until a
// person connects it again.
const asCredentials = async <Value>(run: () => Promise<Value>): Promise<Value> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GoogleAuthorizationError || error instanceof DriveUnauthorizedError) {
      throw new SourceCredentialsError(`${error.message} Connect the source to Google again.`, {
        cause: error,
      });
    }
    throw error;
  }
};

const clientOf = async (deps: DriveConnectorDeps): Promise<GoogleClient> => {
  const client = await deps.client();
  if (client === undefined) throw new SourceCredentialsError(NO_CLIENT);
  return client;
};

const driveOf = async (
  deps: DriveConnectorDeps,
  refreshToken: string | undefined,
  signal: AbortSignal,
): Promise<DriveApi> => {
  if (refreshToken === undefined) {
    throw new SourceCredentialsError('The source is not connected to Google yet.');
  }
  const client = await clientOf(deps);
  // Asked once now, so that a revoked authorization is told before any listing.
  await asCredentials(() => deps.oauth.accessToken(client, refreshToken, signal));
  return createDriveApi(deps.drive, (requestSignal) =>
    deps.oauth.accessToken(client, refreshToken, requestSignal),
  );
};

/**
 * Reads a Drive folder with its subfolders, read-only, through the operator's own Google
 * client. Its files stay on Drive: each item is a reference, and `openFile` serves it
 * again once Drive confirmed it still holds the bytes Liasse indexed.
 */
export const createDriveConnector = (
  deps: DriveConnectorDeps,
): SourceConnector<GdriveSourceConfig> => ({
  connect: async (config, refreshToken, signal) => {
    const api = await driveOf(deps, refreshToken, signal);
    return {
      changes: (cursor) => {
        const walk = driveChanges({ api, config, signal }, parseDriveCursor(cursor));
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => asCredentials(() => walk.next()),
            return: () => walk.return(undefined),
          }),
        };
      },
      close: () => Promise.resolve(),
    };
  },
  openFile: (_config, refreshToken, { externalId, checksum }, signal) =>
    asCredentials(async () => {
      const metadataSignal = signal ?? AbortSignal.timeout(60_000);
      const api = await driveOf(deps, refreshToken, metadataSignal);
      const file = await api.file(externalId, metadataSignal);
      if (file === undefined || file.trashed === true || file.mimeType === FOLDER_TYPE) {
        throw new SourceFileUnavailableError('Drive no longer holds this file.');
      }
      if (checksum !== null && file.md5Checksum !== checksum) {
        throw new SourceFileChangedError('Drive holds another version of this file.');
      }
      const body = await api.download(externalId, signal).catch((error: unknown) => {
        if (error instanceof DriveFileRefusedError) {
          throw new SourceFileUnavailableError(error.message, { cause: error });
        }
        throw error;
      });
      if (body === undefined)
        throw new SourceFileUnavailableError('Drive no longer holds this file.');
      return body;
    }),
  forget: async (refreshToken, signal) => {
    await deps.oauth.revoke(refreshToken, signal);
  },
});
