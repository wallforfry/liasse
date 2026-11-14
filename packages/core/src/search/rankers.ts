import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { chunks, documents } from '../db/schema/documents.ts';
import type { Embedder } from '../models/ports.ts';

export interface RankRequest {
  readonly query: string;
  readonly filter: SQL;
  readonly limit: number;
}

export interface RankedChunk {
  readonly chunkId: string;
  readonly documentId: string;
}

// The seam between hybrid search and one way of ranking chunks, best first. The full-text side
// goes through it so that another engine, such as BM25, can replace `rankByFullText`.
export type ChunkRanker = (db: Database, request: RankRequest) => Promise<readonly RankedChunk[]>;

const rankedRows = z.array(z.object({ chunk_id: z.string(), document_id: z.string() }));

const toRankedChunks = (rows: unknown): readonly RankedChunk[] =>
  rankedRows.parse(rows).map((row) => ({ chunkId: row.chunk_id, documentId: row.document_id }));

// The query as read in every language the chunks are written in: see `liasse_tsquery`.
export const searchTsquery = (query: string): SQL =>
  sql`liasse_tsquery(ARRAY(SELECT DISTINCT ${chunks.language} FROM ${chunks}), ${query})`;

export const fullTextCandidates = ({ query, filter, limit }: RankRequest): SQL => sql`
  WITH parsed AS MATERIALIZED (SELECT ${searchTsquery(query)} AS tsquery)
  SELECT ${chunks.id} AS chunk_id, ${chunks.documentId} AS document_id
  FROM ${chunks}
  JOIN ${documents} ON ${documents.id} = ${chunks.documentId}
  WHERE ${chunks.tsv} @@ (SELECT tsquery FROM parsed) AND ${filter}
  ORDER BY ts_rank_cd(${chunks.tsv}, (SELECT tsquery FROM parsed)) DESC, ${chunks.id}
  LIMIT ${limit}
`;

export const rankByFullText: ChunkRanker = async (db, request) =>
  toRankedChunks(await db.execute(fullTextCandidates(request)));

// The inner ORDER BY holds the distance alone, the only form the HNSW index can serve; the
// outer one breaks ties between equal distances.
export const vectorCandidates = (
  embedding: readonly number[],
  { filter, limit }: Pick<RankRequest, 'filter' | 'limit'>,
): SQL => sql`
  SELECT chunk_id, document_id
  FROM (
    SELECT ${chunks.id} AS chunk_id, ${chunks.documentId} AS document_id,
      ${chunks.embedding} <=> ${`[${embedding.join(',')}]`}::vector AS distance
    FROM ${chunks}
    JOIN ${documents} ON ${documents.id} = ${chunks.documentId}
    WHERE ${chunks.embedding} IS NOT NULL AND ${filter}
    ORDER BY distance
    LIMIT ${limit}
  ) AS nearest
  ORDER BY distance, chunk_id
`;

// pgvector stops an HNSW scan after `hnsw.ef_search` candidates (40 by default) and applies the
// limit and the filter to those only. An iterative scan (pgvector 0.8 and later) resumes it
// until the limit is met, so a large limit or a selective filter does not starve the result.
export const rankByVector =
  (embedder: Embedder): ChunkRanker =>
  async (db, request) => {
    const [embedding] = await embedder.embed([request.query], 'query');
    if (embedding === undefined) {
      throw new Error(`Embedder ${embedder.model} returned no embedding for the query`);
    }
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`);
      return toRankedChunks(await tx.execute(vectorCandidates(embedding, request)));
    });
  };
