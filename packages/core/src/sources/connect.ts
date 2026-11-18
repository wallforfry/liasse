import type { SecretBox } from '../settings/secret-box.ts';
import {
  type SourceConnector,
  type SourceConnectors,
  SourceCredentialsError,
  type SourceFileRef,
  type SourceSession,
} from './connector.ts';
import { openSourceSecret } from './secret.ts';
import type { StoredSource } from './store.ts';

/** The connector of a source, its configuration already given. */
export interface BoundConnector {
  readonly connect: (secret: string | undefined, signal: AbortSignal) => Promise<SourceSession>;
  readonly openFile?: (
    secret: string | undefined,
    file: SourceFileRef,
    signal?: AbortSignal,
  ) => Promise<AsyncIterable<Uint8Array>>;
  readonly forget?: (secret: string, signal: AbortSignal) => Promise<void>;
}

const bound = <Config>(connector: SourceConnector<Config>, config: Config): BoundConnector => {
  const { openFile, forget } = connector;
  return {
    connect: (secret, signal) => connector.connect(config, secret, signal),
    ...(openFile === undefined
      ? {}
      : { openFile: (secret, file, signal) => openFile(config, secret, file, signal) }),
    ...(forget === undefined ? {} : { forget }),
  };
};

export const bindConnector = (
  connectors: SourceConnectors,
  source: StoredSource,
): BoundConnector => {
  switch (source.kind) {
    case 'imap':
      return bound(connectors.imap, source.config);
    case 'gdrive':
      return bound(connectors.gdrive, source.config);
  }
};

/** The stored secret of a source, or the refusal a connector would give without it. */
export const readableSecret = (secrets: SecretBox, source: StoredSource): string | undefined => {
  const secret = openSourceSecret(secrets, source.id, source.secret);
  if (secret.state === 'unreadable') {
    throw new SourceCredentialsError(
      'The stored credentials do not decrypt under this AUTH_SECRET: enter them again.',
    );
  }
  return secret.state === 'set' ? secret.value : undefined;
};

/** Opens a session on a source with its stored credentials, through the connector of its kind. */
export const connectSource = async (
  secrets: SecretBox,
  connectors: SourceConnectors,
  source: StoredSource,
  signal: AbortSignal,
): Promise<SourceSession> =>
  bindConnector(connectors, source).connect(readableSecret(secrets, source), signal);
