import type { ImapSourceConfig } from '@liasse/contract';
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
import { SOURCE_CONNECTORS } from './connectors.ts';
import { sourcePollJob } from './schedule.ts';
import { readSource, type StoredSource } from './store.ts';

export const TEST_SECRETS = createSecretBox(TEST_AUTH_SECRET);

export const sourcesContext = (
  db: Database,
  connectors: SourceConnectors = SOURCE_CONNECTORS,
): SourcesContext => ({ db, secrets: TEST_SECRETS, connectors });

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
}

/** A source created through its use case: its first run is queued when it is enabled. */
export const addSource = async (
  db: Database,
  {
    config = SYNTHETIC_IMAP_CONFIG,
    password = 'synthetic-password',
    enabled = true,
  }: SourceSeed = {},
): Promise<string> => {
  const source = await createSource(sourcesContext(db), {
    kind: 'imap',
    name: 'Synthetic mailbox',
    enabled,
    poll_interval_minutes: 5,
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
  return { imap };
};
