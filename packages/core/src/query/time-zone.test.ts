import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DatabaseHandle } from '../db/client.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { runQuery } from './run.ts';

// Thirteen hours ahead of UTC in January: both instants below fall on another day there.
const SESSION_TIME_ZONE = 'Pacific/Auckland';

describe('ingested_at under a session time zone that is not UTC', () => {
  let database: TestDatabase;
  let session: DatabaseHandle;

  const run = (query: unknown) => runQuery(query, { db: session.db });

  const titles = async (query: unknown) => {
    const result = await run(query);
    if (!result.ok || !('rows' in result.value)) throw new Error(JSON.stringify(result));
    return result.value.rows.map(({ title }) => title);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const name = new URL(database.url).pathname.slice(1);
    await database.db.execute(
      sql`ALTER DATABASE ${sql.identifier(name)} SET timezone TO ${sql.raw(`'${SESSION_TIME_ZONE}'`)}`,
    );
    session = createDb(database.url);
    await insertSyntheticDocument(session.db, {
      title: 'early on the tenth',
      ingestedAt: new Date('2026-01-10T01:30:00Z'),
    });
    await insertSyntheticDocument(session.db, {
      title: 'late on the tenth',
      ingestedAt: new Date('2026-01-10T22:30:00Z'),
    });
    await insertSyntheticDocument(session.db, {
      title: 'early on the eleventh',
      ingestedAt: new Date('2026-01-11T00:10:00Z'),
    });
  });

  afterAll(async () => {
    await session.close();
    await database.dispose();
  });

  it('runs in that time zone', async () => {
    expect(await session.db.execute(sql`SHOW timezone`)).toEqual([{ TimeZone: SESSION_TIME_ZONE }]);
  });

  it('compares the UTC day of the instant', async () => {
    expect(await titles({ where: [['ingested_at', '=', '2026-01-10']] })).toEqual([
      'early on the tenth',
      'late on the tenth',
    ]);
    expect(await titles({ where: [['ingested_at', '>', '2026-01-10']] })).toEqual([
      'early on the eleventh',
    ]);
    expect(await titles({ where: [['ingested_at', '<', '2026-01-10']] })).toEqual([]);
  });

  it('groups and orders by the UTC day', async () => {
    expect(
      await run({ aggregate: { count: '*', min: 'ingested_at' }, group_by: ['ingested_at'] }),
    ).toMatchObject({
      ok: true,
      value: {
        groups: [
          { key: { ingested_at: '2026-01-10' }, values: { count: 2, min: '2026-01-10' } },
          { key: { ingested_at: '2026-01-11' }, values: { count: 1, min: '2026-01-11' } },
        ],
      },
    });
  });

  it('returns the instant in UTC', async () => {
    const result = await run({
      where: [['title', '=', 'late on the tenth']],
      select: ['ingested_at'],
    });
    expect(result).toMatchObject({
      ok: true,
      value: { rows: [{ ingested_at: '2026-01-10T22:30:00.000Z' }] },
    });
  });
});
