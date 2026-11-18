import { randomBytes } from 'node:crypto';
import type { ImapSourceConfig } from '@liasse/contract';
import { ImapFlow } from 'imapflow';
import { z } from 'zod';

// These match the `imap` service of docker-compose.dev.yml and of the CI workflow.
export const DEFAULT_TEST_IMAP_HOST = '127.0.0.1';
export const DEFAULT_TEST_IMAP_PORT = 54333;
export const DEFAULT_TEST_IMAP_API = 'http://127.0.0.1:54334';

const REQUEST_TIMEOUT_MS = 10_000;

export interface AppendOptions {
  /** `INBOX` when left out; created first when missing. */
  readonly mailbox?: string;
  /** The internal date, which `SEARCH SINCE` reads. */
  readonly date?: Date;
}

export interface TestMailbox {
  /** A source configuration for this account, from `startDate`, reading `INBOX`. */
  readonly config: ImapSourceConfig;
  readonly password: string;
  /** Appends a raw message; resolves to its UID. */
  readonly append: (message: Uint8Array, options?: AppendOptions) => Promise<number>;
  /** Runs `work` on a connection of its own, logged in to the account. */
  readonly withClient: <Result>(work: (client: ImapFlow) => Promise<Result>) => Promise<Result>;
  readonly dispose: () => Promise<void>;
}

const api = process.env.TEST_IMAP_API ?? DEFAULT_TEST_IMAP_API;

// One connection per request: after the broken answer below, a kept-alive connection to the
// API can be left unusable, and the next request of the process sent on it never answered.
const request = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`${api}${path}`, {
    method,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Connection: 'close',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const call = async (method: string, path: string, body?: unknown): Promise<string> => {
  const response = await request(method, path, body);
  if (!response.ok) {
    throw new Error(`The test IMAP server answered ${String(response.status)} to ${method}`);
  }
  return response.text();
};

const usersSchema = z.array(z.object({ email: z.string() }));

// GreenMail 2.1.3 deletes an account that a session has selected a mailbox of, then fails
// to write its answer (500, "headers already sent"): the deletion is checked by listing.
const deleteAccount = async (email: string): Promise<void> => {
  await (await request('DELETE', `/api/user/${email}`)).body?.cancel();
  const users = usersSchema.parse(JSON.parse(await call('GET', '/api/user')));
  if (users.some((user) => user.email === email)) {
    throw new Error('The test IMAP server kept a throwaway account');
  }
};

/**
 * One throwaway account per call on the IMAP server of the tests, like `createTestBucket`.
 * An unreachable server rejects here, which fails the calling test.
 */
export const createTestMailbox = async (startDate = '2026-01-01'): Promise<TestMailbox> => {
  const login = `test-${randomBytes(8).toString('hex')}`;
  const email = `${login}@example.test`;
  const password = randomBytes(12).toString('hex');
  await call('POST', '/api/user', { email, login, password });
  const config: ImapSourceConfig = {
    host: process.env.TEST_IMAP_HOST ?? DEFAULT_TEST_IMAP_HOST,
    port: Number(process.env.TEST_IMAP_PORT ?? DEFAULT_TEST_IMAP_PORT),
    security: 'none',
    username: login,
    mailboxes: ['INBOX'],
    start_date: startDate,
    include_messages_without_attachments: false,
  };
  const withClient: TestMailbox['withClient'] = async (work) => {
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: false,
      doSTARTTLS: false,
      auth: { user: login, pass: password },
      logger: false,
    });
    client.on('error', () => undefined);
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.logout();
    }
  };
  return {
    config,
    password,
    append: (message, { mailbox = 'INBOX', date } = {}) =>
      withClient(async (client) => {
        if (mailbox !== 'INBOX') await client.mailboxCreate(mailbox).catch(() => undefined);
        const appended = await client.append(mailbox, Buffer.from(message), [], date);
        if (appended === false || appended.uid === undefined) {
          throw new Error('The test IMAP server did not append the message');
        }
        return appended.uid;
      }),
    withClient,
    dispose: () => deleteAccount(email),
  };
};
