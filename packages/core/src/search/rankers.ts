import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { chunks, documents } from '../db/schema/documents.ts';
import type { Embedder } from '../models/ports.ts';

export interface RankRequest {
  readonly query: string;
  // `query` as parsed by `parseSearchQuery`.
  readonly tsquery: string;
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

export const fullTextCandidates = ({ tsquery, filter, limit }: RankRequest): SQL => sql`
  SELECT ${chunks.id} AS chunk_id, ${chunks.documentId} AS document_id
  FROM ${chunks}
  JOIN ${documents} ON ${documents.id} = ${chunks.documentId}
  WHERE ${chunks.tsv} @@ ${tsquery}::tsquery AND ${filter}
  ORDER BY ts_rank_cd(${chunks.tsv}, ${tsquery}::tsquery) DESC, ${chunks.id}
  LIMIT ${limit}
`;

export const rankByFullText: ChunkRanker = async (db, request) =>
  toRankedChunks(await db.execute(fullTextCandidates(request)));

type NearestRequest = Pick<RankRequest, 'filter' | 'limit'>;

const nearestChunks = (distance: SQL, { filter, limit }: NearestRequest): SQL => sql`
  SELECT chunk_id, document_id
  FROM (
    SELECT ${chunks.id} AS chunk_id, ${chunks.documentId} AS document_id, ${distance} AS distance
    FROM ${chunks}
    JOIN ${documents} ON ${documents.id} = ${chunks.documentId}
    WHERE ${chunks.embedding} IS NOT NULL AND ${filter}
    ORDER BY distance
    LIMIT ${limit}
  ) AS nearest
  ORDER BY distance, chunk_id
`;

const cosineDistance = (embedding: readonly number[]): SQL =>
  sql`${chunks.embedding} <=> ${`[${embedding.join(',')}]`}::vector`;

// The inner ORDER BY holds the distance alone, the only form the HNSW index can serve; the
// outer one breaks ties between equal distances.
export const vectorCandidates = (embedding: readonly number[], request: NearestRequest): SQL =>
  nearestChunks(cosineDistance(embedding), request);

// The same ordering in a form no index can serve: Postgres filters first, then sorts what is
// left by its exact distance.
export const exactVectorCandidates = (embedding: readonly number[], request: NearestRequest): SQL =>
  nearestChunks(sql`(${cosineDistance(embedding)}) + 0`, request);

// pgvector stops an HNSW scan after `hnsw.ef_search` candidates (40 by default) and applies the
// limit and the filter to those only. An iterative scan (pgvector 0.8 and later) resumes it
// until the limit is met or `hnsw.max_scan_tuples` tuples (20,000 by default) were visited.
export const scanVectorIndex = (
  db: Database,
  embedding: readonly number[],
  request: NearestRequest,
): Promise<readonly RankedChunk[]> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`);
    return toRankedChunks(await tx.execute(vectorCandidates(embedding, request)));
  });

// A scan that comes back short either met every chunk that passes the filter, or gave up on a
// filter too selective for it. Both leave few enough chunks for an exact ordering, which then
// replaces the scan.
export const rankByVector =
  (embedder: Embedder): ChunkRanker =>
  async (db, request) => {
    const [embedding] = await embedder.embed([request.query], 'query');
    if (embedding === undefined) {
      throw new Error(`Embedder ${embedder.model} returned no embedding for the query`);
    }
    const scanned = await scanVectorIndex(db, embedding, request);
    return scanned.length >= request.limit
      ? scanned
      : toRankedChunks(await db.execute(exactVectorCandidates(embedding, request)));
  };
