import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { chunks } from '../db/schema/documents.ts';
import { searchTsquery } from './rankers.ts';

export const HIGHLIGHT_MARK = '**';

// A hard bound for text that has no word boundary; `ts_headline` already limits the words.
export const MAX_SNIPPET_LENGTH = 600;

const HEADLINE_OPTIONS = [
  `StartSel=${HIGHLIGHT_MARK}`,
  `StopSel=${HIGHLIGHT_MARK}`,
  'MaxFragments=2',
  'MaxWords=30',
  'MinWords=10',
  'FragmentDelimiter=" ... "',
].join(', ');

export interface Snippet {
  readonly text: string;
  readonly pageFrom: number;
  readonly pageTo: number;
}

const snippetRows = z.array(
  z.object({
    chunk_id: z.string(),
    page_from: z.number().int(),
    page_to: z.number().int(),
    excerpt: z.string(),
  }),
);

// Excerpts of the chunks around the words of the query, in the chunk's own language. A chunk
// found by its embedding alone has no such word: its excerpt is then its opening words.
export const readSnippets = async (
  db: Database,
  chunkIds: readonly string[],
  query: string,
): Promise<ReadonlyMap<string, Snippet>> => {
  if (chunkIds.length === 0) return new Map();
  const rows = snippetRows.parse(
    await db.execute(sql`
      WITH parsed AS MATERIALIZED (SELECT ${searchTsquery(query)} AS tsquery)
      SELECT ${chunks.id} AS chunk_id, ${chunks.pageFrom} AS page_from, ${chunks.pageTo} AS page_to,
        left(
          ts_headline(
            liasse_regconfig(${chunks.language}), ${chunks.text}, (SELECT tsquery FROM parsed),
            ${HEADLINE_OPTIONS}
          ),
          ${MAX_SNIPPET_LENGTH}
        ) AS excerpt
      FROM ${chunks}
      WHERE ${inArray(chunks.id, [...chunkIds])}
    `),
  );
  return new Map(
    rows.map((row) => [
      row.chunk_id,
      { text: row.excerpt, pageFrom: row.page_from, pageTo: row.page_to },
    ]),
  );
};
