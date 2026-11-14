import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { chunks } from '../db/schema/documents.ts';

// A hard bound for text that has no word boundary; `ts_headline` already limits the words.
export const MAX_SNIPPET_LENGTH = 600;

// Private-use characters around the words `ts_headline` matched. They are removed from the
// document text first, so a document cannot forge a highlight, and never reach the caller.
const MATCH_START = '\u{E000}';
const MATCH_END = '\u{E001}';

const HEADLINE_OPTIONS = [
  `StartSel=${MATCH_START}`,
  `StopSel=${MATCH_END}`,
  'MaxFragments=2',
  'MaxWords=30',
  'MinWords=10',
  'FragmentDelimiter=" ... "',
].join(', ');

// Offsets in UTF-16 code units into `text`, `end` excluded.
export interface Highlight {
  readonly start: number;
  readonly end: number;
}

export interface Snippet {
  // Untrusted document content, unescaped: escape it for the medium it is shown in.
  readonly text: string;
  // The words of the query found in `text`.
  readonly highlights: readonly Highlight[];
  readonly pageFrom: number;
  readonly pageTo: number;
}

type Excerpt = Pick<Snippet, 'text' | 'highlights'>;

const isHighSurrogate = (codeUnit: number): boolean => codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff;

const truncate = ({ text, highlights }: Excerpt, maxLength: number): Excerpt => {
  if (text.length <= maxLength) return { text, highlights };
  const cut = isHighSurrogate(text.charCodeAt(maxLength - 1)) ? maxLength - 1 : maxLength;
  return {
    text: text.slice(0, cut),
    highlights: highlights
      .filter(({ start }) => start < cut)
      .map(({ start, end }) => ({ start, end: Math.min(end, cut) })),
  };
};

// Turns the marked headline into plain text and the ranges of its matches.
export const toExcerpt = (headline: string, maxLength = MAX_SNIPPET_LENGTH): Excerpt => {
  const [opening = '', ...marked] = headline.split(MATCH_START);
  const excerpt = marked.reduce<Excerpt>(
    ({ text, highlights }, part) => {
      const [match = '', ...rest] = part.split(MATCH_END);
      return {
        text: text + match + rest.join(''),
        highlights: [...highlights, { start: text.length, end: text.length + match.length }],
      };
    },
    { text: opening, highlights: [] },
  );
  return truncate(excerpt, maxLength);
};

const snippetRows = z.array(
  z.object({
    chunk_id: z.string(),
    page_from: z.number().int(),
    page_to: z.number().int(),
    headline: z.string(),
  }),
);

// Excerpts of the chunks around the words of the query, in the chunk's own language. A chunk
// found by its embedding alone has no such word: its excerpt is then its opening words.
export const readSnippets = async (
  db: Database,
  chunkIds: readonly string[],
  tsquery: string,
): Promise<ReadonlyMap<string, Snippet>> => {
  if (chunkIds.length === 0) return new Map();
  const rows = snippetRows.parse(
    await db.execute(sql`
      SELECT ${chunks.id} AS chunk_id, ${chunks.pageFrom} AS page_from, ${chunks.pageTo} AS page_to,
        ts_headline(
          liasse_regconfig(${chunks.language}),
          translate(${chunks.text}, ${MATCH_START + MATCH_END}, ''),
          ${tsquery}::tsquery,
          ${HEADLINE_OPTIONS}
        ) AS headline
      FROM ${chunks}
      WHERE ${inArray(chunks.id, [...chunkIds])}
    `),
  );
  return new Map(
    rows.map((row) => [
      row.chunk_id,
      { ...toExcerpt(row.headline), pageFrom: row.page_from, pageTo: row.page_to },
    ]),
  );
};
