import type postgres from 'postgres';
import { z } from 'zod';
import { StartupError } from '../domain/errors.ts';
import { isVersionAtLeast } from './extension-version.ts';

// Hybrid search relies on iterative HNSW scans, which pgvector has from 0.8.0.
export const MIN_PGVECTOR_VERSION = [0, 8, 0] as const;

export class PgvectorVersionError extends StartupError {
  override readonly name = 'PgvectorVersionError';
  readonly installed: string | undefined;

  constructor(installed: string | undefined) {
    super(
      `Liasse needs pgvector ${MIN_PGVECTOR_VERSION.join('.')} or later and this database ` +
        `${installed === undefined ? 'has no pgvector to install' : `has pgvector ${installed}`}. ` +
        'Install a recent pgvector on the server, run `ALTER EXTENSION vector UPDATE` in this ' +
        'database if the extension is already there, then start again.',
    );
    this.installed = installed;
  }
}

export type PgvectorVersionReader = (sql: postgres.ISql) => Promise<string | undefined>;

const versionRows = z.tuple([z.object({ version: z.string().nullable() })]);

// The version of the extension in this database, or the one the server would install: the
// first migration is what creates it, and the check comes before anything is written.
export const availablePgvectorVersion: PgvectorVersionReader = async (sql) => {
  const [{ version }] = versionRows.parse([
    ...(await sql`
      SELECT coalesce(
        (SELECT extversion FROM pg_extension WHERE extname = 'vector'),
        (SELECT default_version FROM pg_available_extensions WHERE name = 'vector')
      ) AS version
    `),
  ]);
  return version ?? undefined;
};

export const assertSupportedPgvector = (installed: string | undefined): void => {
  if (installed === undefined || !isVersionAtLeast(installed, MIN_PGVECTOR_VERSION))
    throw new PgvectorVersionError(installed);
};
