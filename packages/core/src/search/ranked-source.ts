import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import type { Embedder } from '../models/ports.ts';

// A table of rows derived from documents that hybrid search can rank: chunks, facts. Each
// row has a full-text column, an embedding and the document it comes from.
export interface RankedSource {
  readonly table: PgTable;
  readonly id: PgColumn;
  readonly documentId: PgColumn;
  readonly language: PgColumn;
  readonly tsv: PgColumn;
  readonly embedding: PgColumn;
}

export interface RankRequest {
  readonly query: string;
  // `query` as parsed by `parseQueryFor`.
  readonly tsquery: string;
  // A predicate over `documents` and the rows of the source.
  readonly filter: SQL;
  readonly limit: number;
}

export interface RankedRow {
  readonly id: string;
  readonly documentId: string;
}

const rankedRows = z.array(z.object({ row_id: z.string(), document_id: z.string() }));

export const toRankedRows = (rows: unknown): readonly RankedRow[] =>
  rankedRows.parse(rows).map((row) => ({ id: row.row_id, documentId: row.document_id }));

const parsedRows = z.array(z.object({ tsquery: z.string().nullable() }));

// The query as read in every language the rows of the source are written in (see
// `liasse_tsquery`), in the text form of a tsquery. Parsed once per search: finding the
// languages in use scans an index. Undefined when the source holds no row, hence no language
// to read the query in.
export const parseQueryFor = async (
  db: Database,
  { table, language }: RankedSource,
  query: string,
): Promise<string | undefined> =>
  parsedRows.parse(
    await db.execute(sql`
      SELECT liasse_tsquery(
        ARRAY(SELECT DISTINCT ${language} FROM ${table}), ${query}
      )::text AS tsquery
    `),
  )[0]?.tsquery ?? undefined;

// Every ranking leaves tombstones out itself, whatever filter it is given: a deleted document
// must not come back through a caller that forgot the condition.

export const fullTextCandidatesOf = (
  { table, id, documentId, tsv }: RankedSource,
  { tsquery, filter, limit }: RankRequest,
): SQL => sql`
  SELECT ${id} AS row_id, ${documentId} AS document_id
  FROM ${table}
  JOIN ${documents} ON ${documents.id} = ${documentId}
  WHERE ${tsv} @@ ${tsquery}::tsquery AND ${isLiveDocument} AND ${filter}
  ORDER BY ts_rank_cd(${tsv}, ${tsquery}::tsquery) DESC, ${id}
  LIMIT ${limit}
`;

export const rankByFullTextIn = async (
  db: Database,
  source: RankedSource,
  request: RankRequest,
): Promise<readonly RankedRow[]> =>
  toRankedRows(await db.execute(fullTextCandidatesOf(source, request)));

export type NearestRequest = Pick<RankRequest, 'filter' | 'limit'>;

const nearestRows = (
  { table, id, documentId, embedding }: RankedSource,
  distance: SQL,
  { filter, limit }: NearestRequest,
): SQL => sql`
  SELECT row_id, document_id
  FROM (
    SELECT ${id} AS row_id, ${documentId} AS document_id, ${distance} AS distance
    FROM ${table}
    JOIN ${documents} ON ${documents.id} = ${documentId}
    WHERE ${embedding} IS NOT NULL AND ${isLiveDocument} AND ${filter}
    ORDER BY distance
    LIMIT ${limit}
  ) AS nearest
  ORDER BY distance, row_id
`;

const cosineDistance = ({ embedding }: RankedSource, query: readonly number[]): SQL =>
  sql`${embedding} <=> ${`[${query.join(',')}]`}::vector`;

// The inner ORDER BY holds the distance alone, the only form the HNSW index can serve; the
// outer one breaks ties between equal distances.
export const vectorCandidatesOf = (
  source: RankedSource,
  embedding: readonly number[],
  request: NearestRequest,
): SQL => nearestRows(source, cosineDistance(source, embedding), request);

// The same ordering in a form no index can serve: Postgres filters first, then sorts what is
// left by its exact distance.
export const exactVectorCandidatesOf = (
  source: RankedSource,
  embedding: readonly number[],
  request: NearestRequest,
): SQL => nearestRows(source, sql`(${cosineDistance(source, embedding)}) + 0`, request);

// pgvector stops an HNSW scan after `hnsw.ef_search` candidates (40 by default) and applies the
// limit and the filter to those only. An iterative scan (pgvector 0.8 and later) resumes it
// until the limit is met or `hnsw.max_scan_tuples` tuples (20,000 by default) were visited.
export const scanVectorIndexOf = (
  db: Database,
  source: RankedSource,
  embedding: readonly number[],
  request: NearestRequest,
): Promise<readonly RankedRow[]> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`);
    return toRankedRows(await tx.execute(vectorCandidatesOf(source, embedding, request)));
  });

// A scan that comes back short either met every row that passes the filter, or gave up on a
// filter too selective for it. Both leave few enough rows for an exact ordering, which then
// replaces the scan.
export type SourceIndexScan = (
  db: Database,
  embedding: readonly number[],
  request: NearestRequest,
) => Promise<readonly RankedRow[]>;

export const rankByVectorIn = async (
  db: Database,
  source: RankedSource,
  embedder: Embedder,
  request: RankRequest,
  scan: SourceIndexScan = (reader, embedding, near) =>
    scanVectorIndexOf(reader, source, embedding, near),
): Promise<readonly RankedRow[]> => {
  const [embedding] = await embedder.embed([request.query], 'query');
  if (embedding === undefined) {
    throw new Error(`Embedder ${embedder.model} returned no embedding for the query`);
  }
  const scanned = await scan(db, embedding, request);
  return scanned.length >= request.limit
    ? scanned
    : toRankedRows(await db.execute(exactVectorCandidatesOf(source, embedding, request)));
};
