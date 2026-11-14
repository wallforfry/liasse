import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  dropTestDatabases,
  LEAKED_MIN_AGE_SECONDS,
  leakedDatabases,
  listTestServerDatabases,
} from './clean-test-databases.ts';
import { databaseExists, newTestDatabaseName, urlOfDatabase, withAdmin } from './test-server.ts';

const OLD = LEAKED_MIN_AGE_SECONDS;

describe('leakedDatabases', () => {
  it('takes the test databases without a session and older than the margin', () => {
    expect(
      leakedDatabases([
        { name: 'liasse_test_0001', connections: 0, ageSeconds: OLD },
        { name: 'liasse_test_0002', connections: 1, ageSeconds: OLD },
        { name: 'liasse_test_0003', connections: 0, ageSeconds: OLD - 1 },
      ]),
    ).toEqual(['liasse_test_0001']);
  });

  it('takes an idle template whatever its age', () => {
    expect(
      leakedDatabases([
        { name: 'liasse_template_0001_384', connections: 0, ageSeconds: 0 },
        { name: 'liasse_template_0002_384', connections: 1, ageSeconds: OLD },
      ]),
    ).toEqual(['liasse_template_0001_384']);
  });
});

describe('listTestServerDatabases and dropTestDatabases', () => {
  const create = async (): Promise<string> => {
    const name = newTestDatabaseName();
    await withAdmin((admin) => admin.unsafe(`CREATE DATABASE ${name}`));
    return name;
  };

  it('lists a test database with its sessions and age', async () => {
    const name = await create();
    try {
      const listed = await withAdmin(listTestServerDatabases);
      const entry = listed.find((database) => database.name === name);
      expect(entry).toMatchObject({ name, connections: 0 });
      expect(entry?.ageSeconds).toBeGreaterThanOrEqual(0);
      expect(entry?.ageSeconds).toBeLessThan(OLD);
      expect(listed.map((database) => database.name)).not.toContain('liasse_test');
    } finally {
      await withAdmin((admin) => admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    }
  });

  // A repeatable read snapshot taken before the drop still shows the database row once its
  // directory is gone: the state a listing meets when another suite drops a database mid-scan.
  it('leaves out a database dropped between the catalog scan and the file stat', async () => {
    const name = await create();
    const listed = await withAdmin((admin) =>
      admin.begin('isolation level repeatable read', async (snapshot) => {
        await snapshot`SELECT FROM pg_database`;
        await withAdmin((other) => other.unsafe(`DROP DATABASE ${name}`));
        return listTestServerDatabases(snapshot);
      }),
    );
    expect(listed.map((database) => database.name)).not.toContain(name);
  });

  it('drops an idle database and keeps one a session holds', async () => {
    const idle = await create();
    const held = await create();
    const session = postgres(urlOfDatabase(held), { max: 1 });
    try {
      await session`SELECT 1`;
      const result = await withAdmin((admin) => dropTestDatabases(admin, [idle, held]));
      expect(result).toEqual({ dropped: [idle], kept: [held] });
      expect(await withAdmin((admin) => databaseExists(admin, idle))).toBe(false);
      expect(await withAdmin((admin) => databaseExists(admin, held))).toBe(true);
    } finally {
      await session.end();
      await withAdmin((admin) => admin.unsafe(`DROP DATABASE IF EXISTS ${held} WITH (FORCE)`));
    }
  });
});
