import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { Embedder } from '../models/ports.ts';
import { documentFilter } from './filters.ts';
import { reciprocalRankFusion } from './fusion.ts';
import { type DocumentGroup, groupByDocument } from './grouping.ts';
import { type SearchInput, searchInputSchema } from './input.ts';
import { type ChunkRanker, rankByFullText, rankByVector, type RankedChunk } from './rankers.ts';
import { readSnippets, type Snippet } from './snippets.ts';

// How many chunks each ranker contributes to the fusion.
export const CANDIDATES_PER_RANKER = 100;

export interface SearchDeps {
  readonly db: Database;
  readonly embedder: Embedder;
  readonly fullText?: ChunkRanker;
  readonly candidatesPerRanker?: number;
}

export interface SearchHit {
  readonly id: string;
  readonly title: string | null;
  readonly type: string | null;
  readonly core: JsonObject;
  readonly snippets: readonly Snippet[];
  readonly score: number;
}

const readDocuments = async (db: Database, ids: readonly string[]) => {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      core: documents.core,
      type: docTypes.slug,
    })
    .from(documents)
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(inArray(documents.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row]));
};

const toHits = async (
  db: Database,
  groups: readonly DocumentGroup[],
  query: string,
): Promise<readonly SearchHit[]> => {
  if (groups.length === 0) return [];
  const [documentsById, snippetsByChunk] = await Promise.all([
    readDocuments(
      db,
      groups.map((group) => group.documentId),
    ),
    readSnippets(
      db,
      groups.flatMap((group) => group.chunkIds),
      query,
    ),
  ]);
  // A document or a chunk deleted since the candidates were read is left out.
  return groups.flatMap(({ documentId, score, chunkIds }) => {
    const document = documentsById.get(documentId);
    const snippets = chunkIds.flatMap((chunkId) => snippetsByChunk.get(chunkId) ?? []);
    return document === undefined || snippets.length === 0
      ? []
      : [{ ...document, snippets, score }];
  });
};

export const search = async (
  {
    db,
    embedder,
    fullText = rankByFullText,
    candidatesPerRanker = CANDIDATES_PER_RANKER,
  }: SearchDeps,
  input: SearchInput,
): Promise<readonly SearchHit[]> => {
  const { query, filters, limit, includePrivate } = searchInputSchema.parse(input);
  // Postgres text cannot hold a NUL character.
  const text = query.replaceAll('\u0000', ' ').trim();
  if (text === '') return [];
  const request = {
    query: text,
    filter: documentFilter(filters, includePrivate),
    limit: candidatesPerRanker,
  };
  const rankings = await Promise.all([fullText(db, request), rankByVector(embedder)(db, request)]);
  const scores = reciprocalRankFusion(
    rankings.map((ranking) => ranking.map((chunk) => chunk.chunkId)),
  );
  const candidates = new Map<string, RankedChunk>(
    rankings.flat().map((chunk) => [chunk.chunkId, chunk]),
  );
  const groups = groupByDocument(
    [...candidates.values()].map((chunk) => ({ ...chunk, score: scores.get(chunk.chunkId) ?? 0 })),
    limit,
  );
  return toHits(db, groups, text);
};
