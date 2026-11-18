import type { SecretBox } from '../settings/secret-box.ts';
import { SourceCredentialsError, type SourceConnectors, type SourceSession } from './connector.ts';
import { openSourceSecret } from './secret.ts';
import type { StoredSource } from './store.ts';

/** Opens a session on a source with its stored credentials, through the connector of its kind. */
export const connectSource = (
  secrets: SecretBox,
  connectors: SourceConnectors,
  source: StoredSource,
  signal: AbortSignal,
): Promise<SourceSession> => {
  const secret = openSourceSecret(secrets, source.id, source.secret);
  if (secret.state === 'unreadable') {
    return Promise.reject(
      new SourceCredentialsError(
        'The stored password does not decrypt under this AUTH_SECRET: enter it again.',
      ),
    );
  }
  return connectors[source.kind].connect(
    source.config,
    secret.state === 'set' ? secret.value : undefined,
    signal,
  );
};
