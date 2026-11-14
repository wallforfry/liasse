import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { chunks, documents, isLiveDocument } from '../db/schema/documents.ts';
import { toRankedRows } from './ranked-source.ts';
import { type ChunkRanker, rankByFullText, type RankRequest, toRankedChunks } from './rankers.ts';

// pg_search serves a query only when its left-hand side is the indexed expression itself.
const bm25Document = sql`liasse_bm25_document(${chunks.language}, ${chunks.text})`;

const termRows = z.tuple([z.object({ terms: z.array(z.string()) })]);

// The lexemes of the query in every language the chunks are written in, as the index holds
// them; none when a chunk can match the query without holding one of its lexemes, which
// `querytree` reports as `T` (`-gas`, `invoice or -gas`). Negated words are among them, but
// `tsv @@ tsquery` still decides which chunks match, and a match holds none of them.
export const bm25QueryTerms = async (
  db: Pick<Database, 'execute'>,
  { query, tsquery }: Pick<RankRequest, 'query' | 'tsquery'>,
): Promise<readonly string[]> => {
  const [{ terms }] = termRows.parse([
    ...(await db.execute(sql`
      SELECT CASE WHEN querytree(${tsquery}::tsquery) IN ('', 'T') THEN ARRAY[]::text[] ELSE ARRAY(
        SELECT DISTINCT entries.lexeme
        FROM unnest(ARRAY(SELECT DISTINCT ${chunks.language} FROM ${chunks})) AS codes(code),
          unnest(liasse_tsvector(codes.code, ${query})) AS entries
        ORDER BY entries.lexeme
      ) END AS terms
    `)),
  ]);
  return terms;
};

// The terms travel as bound parameters, each one an exact token: pg_search parses no query
// syntax out of them, so no input can make it raise.
export const bm25Candidates = (
  { tsquery, filter, limit }: RankRequest,
  terms: readonly string[],
): SQL => sql`
  SELECT ${chunks.id} AS row_id, ${chunks.documentId} AS document_id
  FROM ${chunks}
  JOIN ${documents} ON ${documents.id} = ${chunks.documentId}
  WHERE ${bm25Document} ||| ARRAY[${sql.join(
    terms.map((term) => sql`${term}`),
    sql`, `,
  )}]::text[]
    AND ${chunks.tsv} @@ ${tsquery}::tsquery AND ${isLiveDocument} AND ${filter}
  ORDER BY pdb.score(${chunks.id}) DESC, ${chunks.id}
  LIMIT ${limit}
`;

// The same chunks as `rankByFullText`, ordered by BM25. A query that matches chunks without
// any of its terms gives BM25 nothing to score and is ranked by `rankByFullText`.
export const rankByBm25: ChunkRanker = async (db, request) => {
  const ranked = await db.transaction(async (tx) => {
    // pg_search logs a WARNING for each part of these queries it cannot run itself: the
    // DISTINCT over languages, the join with `documents`. Set in the transaction only, so no
    // connection carries a pg_search setting, which a pooler such as PgBouncer may refuse.
    await tx.execute(sql`SELECT set_config('paradedb.planner_warnings', 'off', true)`);
    const terms = await bm25QueryTerms(tx, request);
    return terms.length === 0
      ? undefined
      : toRankedChunks(toRankedRows(await tx.execute(bm25Candidates(request, terms))));
  });
  return ranked ?? rankByFullText(db, request);
};
