import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { chunks, documents, isLiveDocument } from '../db/schema/documents.ts';
import { toRankedRows } from './ranked-source.ts';
import { type ChunkRanker, rankByFullText, type RankRequest, toRankedChunks } from './rankers.ts';

export const BM25_INDEX = 'chunks_bm25_idx';

// Arbitrary constant: concurrent servers serialize the creation of the index on it.
const BM25_INDEX_LOCK_KEY = 5_417_330;

// pg_search serves a query only when its left-hand side is the indexed expression itself.
const bm25Document = sql`liasse_bm25_document(${chunks.language}, ${chunks.text})`;

// Created at startup rather than by a migration: a migration runs once, so a database that
// gained the extension after it would never get the index. Rows written before the index
// existed are indexed by its creation, the later ones as they are written.
export const ensureBm25Index = (db: Database): Promise<void> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BM25_INDEX_LOCK_KEY})`);
    await tx.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS ${BM25_INDEX} ON chunks USING paradedb ` +
          `(id, ((liasse_bm25_document(language, text))::pdb.whitespace('alias=terms')))`,
      ),
    );
  });

const termRows = z.tuple([z.object({ terms: z.array(z.string()) })]);

// The lexemes of the query in every language the chunks are written in, as the index holds
// them; none when a chunk can match the query without holding one of its lexemes, which
// `querytree` reports as `T` (`-gas`, `invoice or -gas`). Negated words are among them, but
// `tsv @@ tsquery` still decides which chunks match, and a match holds none of them.
export const bm25QueryTerms = async (
  db: Database,
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
  const terms = await bm25QueryTerms(db, request);
  if (terms.length === 0) return rankByFullText(db, request);
  return toRankedChunks(toRankedRows(await db.execute(bm25Candidates(request, terms))));
};
