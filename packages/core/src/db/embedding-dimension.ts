import type postgres from 'postgres';
import { z } from 'zod';
import { StartupError } from '../domain/errors.ts';
import { MAX_EMBEDDING_DIM } from '../domain/limits.ts';

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

const dimensionRows = z.array(z.object({ dimension: z.number().int() }));

// For a pgvector column, `atttypmod` holds the declared dimension, which makes the
// catalog the record of the installed dimension without a dedicated table.
export const installedEmbeddingDimensions = async (
  sql: postgres.ISql,
): Promise<readonly number[]> =>
  dimensionRows
    .parse(
      await sql`
        SELECT DISTINCT a.atttypmod AS dimension
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND t.typname = 'vector'
          AND NOT a.attisdropped
      `,
    )
    .map((row) => row.dimension);

export const assertInstalledEmbeddingDimension = async (
  sql: postgres.ISql,
  embeddingDim: number,
): Promise<void> => {
  const mismatch = (await installedEmbeddingDimensions(sql)).find(
    (installed) => installed !== embeddingDim,
  );
  if (mismatch !== undefined) throw new EmbeddingDimensionMismatchError(mismatch, embeddingDim);
};
