import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  dropTestDatabases,
  LEAKED_MIN_AGE_SECONDS,
  leakedDatabases,
  listTestServerDatabases,
} from './clean-test-databases.ts';
import { createTestDatabase, TEST_EMBEDDING_DIM } from './test-database.ts';
import { databaseExists, newTestDatabaseName, urlOfDatabase, withAdmin } from './test-server.ts';
import { createMigratedDatabase, privateTemplateName } from './test-template.ts';

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

  // A copy left without a session is what a killed run leaves; one in use is a running suite's.
  describe('on a template and its copies', () => {
    const template = privateTemplateName(TEST_EMBEDDING_DIM);
    const leakedCopy = async (): Promise<string> => {
      const name = newTestDatabaseName();
      await withAdmin((admin) => createMigratedDatabase(admin, name, TEST_EMBEDDING_DIM, template));
      return name;
    };
    const dropTemplate = () =>
      withAdmin((admin) =>
        admin.unsafe(`DROP DATABASE IF EXISTS ${template}`).then(() => undefined),
      );

    it('keeps a template while a copy of it is in use', async () => {
      const inUse = await createTestDatabase({ template });
      try {
        const leaked = await leakedCopy();
        const result = await withAdmin((admin) => dropTestDatabases(admin, [template, leaked]));
        expect(result).toEqual({ dropped: [leaked], kept: [template] });
        expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(true);
      } finally {
        await inUse.dispose();
        await dropTemplate();
      }
    });

    it('drops a template once its leaked copies are dropped', async () => {
      try {
        const leaked = await leakedCopy();
        const result = await withAdmin((admin) => dropTestDatabases(admin, [template, leaked]));
        expect(result).toEqual({ dropped: [leaked, template], kept: [] });
        expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(false);
      } finally {
        await dropTemplate();
      }
    });
  });
});
