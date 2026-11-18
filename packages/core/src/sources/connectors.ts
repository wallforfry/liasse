import type { Database } from '../db/client.ts';
import type { SecretBox } from '../settings/secret-box.ts';
import type { SourceConnectors } from './connector.ts';
import { createDriveConnector } from './gdrive/connector.ts';
import { storedGoogleClient } from './google/client.ts';
import { createGoogleOAuth } from './google/oauth-client.ts';
import { GOOGLE_ENDPOINTS, type GoogleEndpoints, type GoogleOAuth } from './google/oauth.ts';
import { imapConnector } from './imap/connector.ts';

export interface SourceConnectorsDeps {
  readonly db: Database;
  readonly secrets: SecretBox;
  /** Google itself, unless a test serves its HTTP contract. */
  readonly google?: GoogleEndpoints;
}

/** The connector of every kind of source, and the Google client they share. */
export interface SourceRuntime {
  readonly connectors: SourceConnectors;
  readonly oauth: GoogleOAuth;
  readonly endpoints: GoogleEndpoints;
}

export const createSourceRuntime = ({
  db,
  secrets,
  google = GOOGLE_ENDPOINTS,
}: SourceConnectorsDeps): SourceRuntime => {
  const oauth = createGoogleOAuth(google);
  return {
    connectors: {
      imap: imapConnector,
      gdrive: createDriveConnector({
        oauth,
        client: storedGoogleClient(db, secrets),
        drive: google.drive,
      }),
    },
    oauth,
    endpoints: google,
  };
};
