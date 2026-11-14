import type postgres from 'postgres';
import { z } from 'zod';
import { StartupError } from '../domain/errors.ts';

// Structured queries validate stored dates with `pg_input_is_valid`, which Postgres 16
// introduced: on an older server every query that reads a date would fail.
export const MIN_POSTGRES_MAJOR_VERSION = 16;

export class PostgresVersionError extends StartupError {
  override readonly name = 'PostgresVersionError';
  readonly installed: number;

  constructor(installed: number) {
    super(
      `Liasse needs Postgres ${String(MIN_POSTGRES_MAJOR_VERSION)} or later and this server ` +
        `runs Postgres ${String(installed)}. Upgrade the server, then start again.`,
    );
    this.installed = installed;
  }
}

export type PostgresVersionReader = (sql: postgres.ISql) => Promise<number>;

const versionRows = z.tuple([z.object({ major: z.number().int() })]);

// `server_version_num` is the major version times ten thousand, plus the minor one.
export const installedPostgresMajorVersion: PostgresVersionReader = async (sql) => {
  const [{ major }] = versionRows.parse([
    ...(await sql`SELECT current_setting('server_version_num')::int / 10000 AS major`),
  ]);
  return major;
};

export const assertSupportedPostgres = (major: number): void => {
  if (major < MIN_POSTGRES_MAJOR_VERSION) throw new PostgresVersionError(major);
};
