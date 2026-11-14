import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';

// The oldest pg_search that BM25 ranking was verified against. It is also the first that
// builds an index without `key_field` and names its tokenizers `pdb.*`, both used here.
export const MIN_PG_SEARCH_VERSION = [0, 26, 0] as const;

export type PgSearchVersionReader = (db: Database) => Promise<string | undefined>;

const versionRows = z.tuple([z.object({ version: z.string().nullable() })]);

// The version of ParadeDB pg_search created in this database. One the server could install
// does not count: creating the extension is the operator's choice.
export const installedPgSearchVersion: PgSearchVersionReader = async (db) => {
  const [{ version }] = versionRows.parse([
    ...(await db.execute(sql`
      SELECT (SELECT extversion FROM pg_extension WHERE extname = 'pg_search') AS version
    `)),
  ]);
  return version ?? undefined;
};
