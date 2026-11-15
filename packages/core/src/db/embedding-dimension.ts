import { MAX_EMBEDDING_DIM } from '@liasse/contract/domain';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';
import { z } from 'zod';
import { StartupError } from '../domain/errors.ts';
import * as schema from './schema/index.ts';

export class EmbeddingDimensionMismatchError extends StartupError {
  override readonly name = 'EmbeddingDimensionMismatchError';
  readonly installed: number;
  readonly requested: number;

  constructor(installed: number, requested: number) {
    super(
      `EMBEDDING_DIM=${String(requested)} does not match the embedding dimension ` +
        `${String(installed)} this database was installed with. The dimension is fixed by the ` +
        `first migration: set EMBEDDING_DIM=${String(installed)}, or start from an empty ` +
        'database to change it.',
    );
    this.installed = installed;
    this.requested = requested;
  }
}

export const assertValidEmbeddingDimension = (embeddingDim: number): void => {
  if (!Number.isInteger(embeddingDim) || embeddingDim < 1 || embeddingDim > MAX_EMBEDDING_DIM) {
    throw new RangeError(
      `embeddingDim must be an integer between 1 and ${String(MAX_EMBEDDING_DIM)}`,
    );
  }
};

// Only the vector columns of the Drizzle schema count: `public` may hold vector columns
// that belong to something else.
const EMBEDDING_COLUMNS: ReadonlySet<string> = new Set(
  Object.values(schema)
    .filter((value) => is(value, PgTable))
    .flatMap((table) => {
      const { name, columns } = getTableConfig(table);
      return columns
        .filter((column) => column.getSQLType().startsWith('vector('))
        .map((column) => `${name}.${column.name}`);
    }),
);

const vectorColumnRows = z.array(
  z.object({ table: z.string(), column: z.string(), dimension: z.number().int() }),
);

// For a pgvector column, `atttypmod` holds the declared dimension, which makes the
// catalog the record of the installed dimension without a dedicated table.
export const installedEmbeddingDimensions = async (
  sql: postgres.ISql,
): Promise<readonly number[]> => {
  const rows = vectorColumnRows.parse(
    await sql`
      SELECT c.relname AS "table", a.attname AS "column", a.atttypmod AS dimension
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND t.typname = 'vector'
        AND NOT a.attisdropped
    `,
  );
  return [
    ...new Set(
      rows
        .filter((row) => EMBEDDING_COLUMNS.has(`${row.table}.${row.column}`))
        .map((row) => row.dimension),
    ),
  ];
};

export const assertInstalledEmbeddingDimension = async (
  sql: postgres.ISql,
  embeddingDim: number,
): Promise<void> => {
  const mismatch = (await installedEmbeddingDimensions(sql)).find(
    (installed) => installed !== embeddingDim,
  );
  if (mismatch !== undefined) throw new EmbeddingDimensionMismatchError(mismatch, embeddingDim);
};
