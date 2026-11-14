import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { chunks } from '../db/schema/documents.ts';

const parsedRows = z.array(z.object({ tsquery: z.string().nullable() }));

// The query as read in every language the chunks are written in (see `liasse_tsquery`), in the
// text form of a tsquery. Parsed once per search: finding the languages in use scans an index.
// Undefined when the index holds no chunk, hence no language to read the query in.
export const parseSearchQuery = async (db: Database, query: string): Promise<string | undefined> =>
  parsedRows.parse(
    await db.execute(sql`
      SELECT liasse_tsquery(
        ARRAY(SELECT DISTINCT ${chunks.language} FROM ${chunks}), ${query}
      )::text AS tsquery
    `),
  )[0]?.tsquery ?? undefined;
