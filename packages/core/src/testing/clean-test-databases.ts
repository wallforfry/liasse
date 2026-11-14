import type postgres from 'postgres';
import { z } from 'zod';
import { TEMPLATE_DATABASE_PREFIX, dropIdleTemplate } from './test-template.ts';
import { type AdminSql, TEST_DATABASE_PREFIX } from './test-server.ts';

// A suite creates its database, then connects to it; a template is built under a test name
// before it is renamed. Both leave a database without a session for a moment, so only one
// older than this is taken for leaked by a killed run.
export const LEAKED_MIN_AGE_SECONDS = 15 * 60;

export interface TestServerDatabase {
  readonly name: string;
  readonly connections: number;
  readonly ageSeconds: number;
}

const databaseRows = z.array(
  z.object({
    name: z.string(),
    connections: z.coerce.number().int(),
    age_seconds: z.coerce.number(),
  }),
);

// Postgres records no creation time; PG_VERSION is written once, when the database is
// created. Reading it takes a superuser, which the test servers' user is. A database another
// suite drops during the scan keeps its catalog row in the statement's snapshot but has lost
// its directory: `missing_ok` turns the stat into null and the row is left out.
export const listTestServerDatabases = async (
  sql: postgres.ISql,
): Promise<readonly TestServerDatabase[]> =>
  databaseRows
    .parse(
      await sql`
        SELECT name, connections, age_seconds
        FROM (
          SELECT d.datname AS name,
            (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.oid) AS connections,
            extract(epoch FROM now()
              - (pg_stat_file('base/' || d.oid || '/PG_VERSION', true)).modification) AS age_seconds
          FROM pg_database d
          WHERE starts_with(d.datname, ${TEST_DATABASE_PREFIX})
            OR starts_with(d.datname, ${TEMPLATE_DATABASE_PREFIX})
        ) listed
        WHERE age_seconds IS NOT NULL
        ORDER BY name
      `,
    )
    .map(({ name, connections, age_seconds }) => ({
      name,
      connections,
      ageSeconds: age_seconds,
    }));

/**
 * Test databases nobody uses: no session, and old enough that no suite is still setting
 * them up. Templates are a cache, dropped whatever their age; a test that needs one again
 * builds it.
 */
export const leakedDatabases = (
  databases: readonly TestServerDatabase[],
  minAgeSeconds: number = LEAKED_MIN_AGE_SECONDS,
): readonly string[] =>
  databases
    .filter(
      ({ name, connections, ageSeconds }) =>
        connections === 0 &&
        (name.startsWith(TEMPLATE_DATABASE_PREFIX) || ageSeconds >= minAgeSeconds),
    )
    .map(({ name }) => name);

export interface CleanResult {
  readonly dropped: readonly string[];
  /** Taken by a session or a test between the listing and the drop. */
  readonly kept: readonly string[];
}

const OBJECT_IN_USE = '55006';

const isObjectInUse = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === OBJECT_IN_USE;

// Never `WITH (FORCE)`: a database someone connected to since the listing is kept.
const dropLeaked = async (sql: AdminSql, name: string): Promise<boolean> => {
  if (name.startsWith(TEMPLATE_DATABASE_PREFIX)) return dropIdleTemplate(sql, name);
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    return true;
  } catch (error) {
    if (isObjectInUse(error)) return false;
    throw error;
  }
};

export const dropTestDatabases = async (
  sql: AdminSql,
  names: readonly string[],
): Promise<CleanResult> => {
  const dropped: string[] = [];
  const kept: string[] = [];
  for (const name of names) {
    if (await dropLeaked(sql, name)) dropped.push(name);
    else kept.push(name);
  }
  return { dropped, kept };
};
