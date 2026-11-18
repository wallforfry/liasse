import { imapSourceConfigSchema, type Source, sourceRunSchema } from '@liasse/contract';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { ingestionSources } from '../db/schema/sources.ts';
import type { SecretBox } from '../settings/secret-box.ts';
import type { SourceConfigs } from './connector.ts';
import { openSourceSecret } from './secret.ts';

export type SourceRow = typeof ingestionSources.$inferSelect;
export type SourceExecutor = Pick<Database, 'select'>;

/** A source as stored, its configuration parsed by the schema of its kind. */
export type StoredSource = Omit<SourceRow, 'kind' | 'config'> & {
  readonly kind: 'imap';
  readonly config: SourceConfigs['imap'];
};

export const parseSourceRow = (row: SourceRow): StoredSource => ({
  ...row,
  kind: row.kind,
  config: imapSourceConfigSchema.parse(row.config),
});

export const readSource = async (
  db: SourceExecutor,
  id: string,
): Promise<StoredSource | undefined> => {
  const [row] = await db.select().from(ingestionSources).where(eq(ingestionSources.id, id));
  return row === undefined ? undefined : parseSourceRow(row);
};

export const readSources = async (db: SourceExecutor): Promise<readonly StoredSource[]> =>
  (await db.select().from(ingestionSources).orderBy(asc(ingestionSources.createdAt))).map(
    parseSourceRow,
  );

/** What the API shows of a source: its secret replaced by whether it is set. */
export const sourceViewOf = (secrets: SecretBox, source: StoredSource): Source => ({
  id: source.id,
  kind: source.kind,
  name: source.name,
  enabled: source.enabled,
  poll_interval_minutes: source.pollIntervalMinutes,
  hint: source.hint,
  private: source.private,
  config: source.config,
  secret: openSourceSecret(secrets, source.id, source.secret).state,
  needs_attention: source.needsAttention,
  last_run: source.lastRun === null ? null : sourceRunSchema.parse(source.lastRun),
  created_at: source.createdAt.toISOString(),
  updated_at: source.updatedAt.toISOString(),
});
