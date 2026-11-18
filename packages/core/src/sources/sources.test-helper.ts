import type { GdriveSourceConfig, ImapSourceConfig } from '@liasse/contract';
import { eq } from 'drizzle-orm';
import { type SourcesContext, createSource } from '../api/sources.ts';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { jobs } from '../db/schema/jobs.ts';
import { ingestionSources } from '../db/schema/sources.ts';
import { createSecretBox } from '../settings/secret-box.ts';
import { TEST_AUTH_SECRET } from '../testing/test-auth.ts';
import type {
  SourceChange,
  SourceConnector,
  SourceConnectors,
  SourceSession,
} from './connector.ts';
import { createSourceRuntime } from './connectors.ts';
import { storedGoogleClient } from './google/client.ts';
import type { GoogleEndpoints } from './google/oauth.ts';
import { sourcePollJob } from './schedule.ts';
import { readSource, type StoredSource } from './store.ts';

export const TEST_SECRETS = createSecretBox(TEST_AUTH_SECRET);

// Tests never reach Google: nothing listens on the discard port, which refuses at once.
const NO_GOOGLE: GoogleEndpoints = {
  consent: 'http://127.0.0.1:9/consent',
  token: 'http://127.0.0.1:9/token',
  revoke: 'http://127.0.0.1:9/revoke',
  drive: 'http://127.0.0.1:9/drive/v3',
};

export const TEST_REDIRECT_URI = 'http://liasse.test/sources/google/callback';

/** The connectors of a test: Google is the fake at `google`, or unreachable. */
export const testConnectors = (db: Database, google: GoogleEndpoints = NO_GOOGLE) =>
  createSourceRuntime({ db, secrets: TEST_SECRETS, google });

export const sourcesContext = (
  db: Database,
  connectors?: SourceConnectors,
  google: GoogleEndpoints = NO_GOOGLE,
): SourcesContext => {
  const runtime = testConnectors(db, google);
  return {
    db,
    secrets: TEST_SECRETS,
    connectors: connectors ?? runtime.connectors,
    google: {
      oauth: runtime.oauth,
      client: storedGoogleClient(db, TEST_SECRETS),
      redirectUri: TEST_REDIRECT_URI,
    },
  };
};

export const SYNTHETIC_IMAP_CONFIG: ImapSourceConfig = {
  host: 'imap.example.test',
  port: 993,
  security: 'tls',
  username: 'synthetic',
  mailboxes: ['INBOX'],
  start_date: '2026-01-01',
  include_messages_without_attachments: false,
};

export interface SourceSeed {
  readonly config?: ImapSourceConfig;
  readonly password?: string;
  readonly enabled?: boolean;
  readonly hint?: string;
  readonly private?: boolean;
}

/** A source created through its use case: its first run is queued when it is enabled. */
export const addSource = async (
  db: Database,
  {
    config = SYNTHETIC_IMAP_CONFIG,
    password = 'synthetic-password',
    enabled = true,
    hint,
    private: isPrivate = false,
  }: SourceSeed = {},
): Promise<string> => {
  const source = await createSource(sourcesContext(db), {
    kind: 'imap',
    name: 'Synthetic mailbox',
    enabled,
    poll_interval_minutes: 5,
    ...(hint === undefined ? {} : { hint }),
    private: isPrivate,
    config,
    secret: { action: 'replace', value: password },
  });
  return source.id;
};

export const storedSource = async (db: Database, id: string): Promise<StoredSource> => {
  const source = await readSource(db, id);
  if (source === undefined) throw new Error(`No source ${id}`);
  return source;
};

export const queuedPolls = async (db: Database) =>
  (await db.select().from(jobs).where(eq(jobs.kind, sourcePollJob.name))).filter(
    ({ status }) => status === 'queued',
  );

export const setCursor = async (db: Database, id: string, cursor: JsonObject | null) => {
  await db.update(ingestionSources).set({ cursor }).where(eq(ingestionSources.id, id));
};

/** Connectors whose IMAP sessions list `changes`; `connect` runs first, for each session. */
export const fakeConnectors = (
  changes: readonly SourceChange[],
  connect: () => Promise<void> = () => Promise.resolve(),
): SourceConnectors => {
  const imap: SourceConnector<ImapSourceConfig> = {
    connect: async (): Promise<SourceSession> => {
      await connect();
      return { changes: () => ReadableStream.from(changes), close: () => Promise.resolve() };
    },
  };
  const gdrive: SourceConnector<GdriveSourceConfig> = {
    connect: async (): Promise<SourceSession> => {
      await connect();
      return { changes: () => ReadableStream.from(changes), close: () => Promise.resolve() };
    },
  };
  return { imap, gdrive };
};
