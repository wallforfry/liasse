import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { runQuery } from './run.ts';

const LARGEST_DOUBLES = '1e308';
const BEYOND_A_DOUBLE = '1e400';

const digits = (first: string, zeros: number): string => `${first}${'0'.repeat(zeros)}`;

describe('numbers at and beyond the range of a double', () => {
  let database: TestDatabase;

  const groupsOf = async (query: Readonly<Record<string, unknown>>) => {
    const result = await runQuery({ type: 'measure', ...query }, { db: database.db });
    if (!result.ok || !('groups' in result.value)) throw new Error(JSON.stringify(result));
    return result.value.groups;
  };

  const titles = async (query: Readonly<Record<string, unknown>>) => {
    const result = await runQuery({ type: 'measure', ...query }, { db: database.db });
    if (!result.ok || !('rows' in result.value)) throw new Error(JSON.stringify(result));
    return result.value.rows.map(({ title }) => title);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    const created = await createType(
      {
        slug: 'measure',
        description: 'A synthetic measure',
        fields: { reading: { type: 'number' } },
      },
      { db, embedder: createFakeEmbedder(), maxNewTypesPerDay: 10, schemaLanguage: 'en' },
    );
    if (!created.ok) throw new Error(created.error.message);
    // JSON cannot carry these through the driver as numbers of JavaScript: `1e400` is
    // Infinity there, and a valid number in a `jsonb`.
    const add = async (title: string, reading: string) => {
      const { id } = await insertSyntheticDocument(db, { typeId: created.value.id, title });
      await db.execute(
        sql`UPDATE documents SET fields = jsonb_build_object('reading', ${reading}::numeric) WHERE id = ${id}`,
      );
    };
    await add('small', '2.5');
    await add('large', LARGEST_DOUBLES);
    await add('as large', LARGEST_DOUBLES);
    await add('beyond', BEYOND_A_DOUBLE);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('sums two of the largest doubles into the exact decimal, as a text', async () => {
    const large = [['title', 'in', ['large', 'as large']]];
    expect(
      await groupsOf({ aggregate: { sum: 'fields.reading', avg: 'fields.reading' }, where: large }),
    ).toEqual([{ key: {}, values: { sum: digits('2', 308), avg: 1e308 } }]);
  });

  it('gives a minimum, a maximum and a group key beyond a double as a text', async () => {
    expect(await groupsOf({ aggregate: { min: 'fields.reading', max: 'fields.reading' } })).toEqual(
      [{ key: {}, values: { min: 2.5, max: digits('1', 400) } }],
    );
    expect(await groupsOf({ aggregate: { count: '*' }, group_by: ['fields.reading'] })).toEqual([
      { key: { 'fields.reading': 2.5 }, values: { count: 1 } },
      { key: { 'fields.reading': 1e308 }, values: { count: 2 } },
      { key: { 'fields.reading': digits('1', 400) }, values: { count: 1 } },
    ]);
  });

  it('gives an average beyond a double as a text', async () => {
    const [group] = await groupsOf({ aggregate: { avg: 'fields.reading' } });
    expect(group?.values.avg).toMatch(/^25\d{398}\.\d+$/);
  });

  it('keeps a number that fits a double a number', async () => {
    const [group] = await groupsOf({
      aggregate: { sum: 'fields.reading', avg: 'fields.reading', max: 'fields.reading' },
      where: [['title', '=', 'small']],
    });
    expect(group?.values).toEqual({ sum: 2.5, avg: 2.5, max: 2.5 });
  });

  it('compares and orders them as numbers', async () => {
    expect(await titles({ where: [['fields.reading', '>', 1e308]] })).toEqual(['beyond']);
    expect(await titles({ where: [['fields.reading', '=', 1e308]] })).toEqual([
      'large',
      'as large',
    ]);
    expect(await titles({ order_by: ['fields.reading', 'desc'], limit: 2 })).toEqual([
      'beyond',
      'large',
    ]);
  });
});
