import type { SQL } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chunks } from '../db/schema/documents.ts';
import type { Embedder } from '../models/ports.ts';
import {
  exactVectorCandidatesOf,
  fullTextCandidatesOf,
  type NearestRequest,
  rankByFullTextIn,
  rankByVectorIn,
  type RankedRow,
  type RankedSource,
  type RankRequest,
  scanVectorIndexOf,
  vectorCandidatesOf,
} from './ranked-source.ts';

export type { RankRequest } from './ranked-source.ts';

export const CHUNK_SOURCE: RankedSource = {
  table: chunks,
  id: chunks.id,
  documentId: chunks.documentId,
  language: chunks.language,
  tsv: chunks.tsv,
  embedding: chunks.embedding,
};

export interface RankedChunk {
  readonly chunkId: string;
  readonly documentId: string;
}

// The seam between hybrid search and one way of ranking chunks, best first. The full-text side
// goes through it, so `rankByBm25` can replace `rankByFullText` (see `prepareFullTextRanking`).
export type ChunkRanker = (db: Database, request: RankRequest) => Promise<readonly RankedChunk[]>;

export const toRankedChunks = (rows: readonly RankedRow[]): readonly RankedChunk[] =>
  rows.map(({ id, documentId }) => ({ chunkId: id, documentId }));

export const fullTextCandidates = (request: RankRequest): SQL =>
  fullTextCandidatesOf(CHUNK_SOURCE, request);

export const rankByFullText: ChunkRanker = async (db, request) =>
  toRankedChunks(await rankByFullTextIn(db, CHUNK_SOURCE, request));

export const vectorCandidates = (embedding: readonly number[], request: NearestRequest): SQL =>
  vectorCandidatesOf(CHUNK_SOURCE, embedding, request);

export const exactVectorCandidates = (embedding: readonly number[], request: NearestRequest): SQL =>
  exactVectorCandidatesOf(CHUNK_SOURCE, embedding, request);

export const scanVectorIndex = async (
  db: Database,
  embedding: readonly number[],
  request: NearestRequest,
): Promise<readonly RankedChunk[]> =>
  toRankedChunks(await scanVectorIndexOf(db, CHUNK_SOURCE, embedding, request));

export type VectorIndexScan = typeof scanVectorIndex;

// Only tests pass `scan`: how far a real HNSW scan gets depends on the levels pgvector draws
// at random when it builds the graph, so a test cannot make one fall short on demand.
export const rankByVector =
  (embedder: Embedder, scan: VectorIndexScan = scanVectorIndex): ChunkRanker =>
  async (db, request) =>
    toRankedChunks(
      await rankByVectorIn(db, CHUNK_SOURCE, embedder, request, async (reader, embedding, near) =>
        (await scan(reader, embedding, near)).map(({ chunkId, documentId }) => ({
          id: chunkId,
          documentId,
        })),
      ),
    );
