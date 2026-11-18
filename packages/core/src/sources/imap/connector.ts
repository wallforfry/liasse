import type { ImapSourceConfig } from '@liasse/contract';
import type { ImapFlowOptions } from 'imapflow';
import { type SourceConnector, SourceCredentialsError } from '../connector.ts';
import { imapChanges } from './changes.ts';
import { parseImapCursor } from './cursor.ts';

const CONNECTION_TIMEOUT_MS = 30_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 5 * 60_000;

const optionsOf = (config: ImapSourceConfig, password: string): ImapFlowOptions => ({
  host: config.host,
  port: config.port,
  secure: config.security === 'tls',
  // Required, not opportunistic: a capability list stripped on the path must not downgrade
  // the connection to clear text.
  doSTARTTLS:
    config.security === 'starttls' ? true : config.security === 'none' ? false : undefined,
  auth: { user: config.username, pass: password },
  logger: false,
  disableAutoIdle: true,
  connectionTimeout: CONNECTION_TIMEOUT_MS,
  greetingTimeout: GREETING_TIMEOUT_MS,
  socketTimeout: SOCKET_TIMEOUT_MS,
});

const refused = (error: unknown): boolean =>
  error instanceof Error && 'authenticationFailed' in error && error.authenticationFailed === true;

/** Reads mailboxes over IMAP, read-only, with a password (an app password on Gmail). */
export const imapConnector: SourceConnector<ImapSourceConfig> = {
  connect: async (config, password, signal) => {
    if (password === undefined) {
      throw new SourceCredentialsError('No password is stored for this mailbox.');
    }
    signal.throwIfAborted();
    // Loaded with the first connection: imapflow and its dependencies weigh some 30 MB of
    // memory, which a server without an IMAP source would carry at idle.
    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow(optionsOf(config, password));
    // A socket error is also emitted: without a listener, Node would end the process. The
    // command in progress rejects with it, which is where it is handled.
    client.on('error', () => undefined);
    const abort = () => {
      client.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await client.connect();
    } catch (error) {
      signal.removeEventListener('abort', abort);
      client.close();
      if (refused(error)) {
        throw new SourceCredentialsError('The server refused the username or the password.', {
          cause: error,
        });
      }
      throw error;
    }
    return {
      changes: (cursor) => imapChanges(client, config, parseImapCursor(cursor)),
      close: async () => {
        signal.removeEventListener('abort', abort);
        await client.logout();
      },
    };
  },
};
