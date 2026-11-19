import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.ts';
import { entities } from '../db/schema/registry.ts';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { runQuery } from './run.ts';

const FIELDS = {
  note: { type: 'text' },
  energy: { type: 'enum', values: ['electricity', 'gas'] },
  quantity: { type: 'number' },
  paid: { type: 'boolean' },
  signed_on: { type: 'date' },
  landlord: { type: 'entity' },
  deposit: { type: 'money' },
  coverage: { type: 'period' },
  tags: { type: 'list', items: { type: 'text' } },
} as const;

// One value of the wrong shape for each field: what a write around the pipeline, or a
// schema that changed since the extraction, leaves behind.
const WRONG = {
  note: 42,
  energy: ['gas'],
  quantity: '12',
  paid: 'true',
  signed_on: '2026-02-31',
  landlord: { id: 'ent_synthetic' },
  deposit: 'EUR 12',
  coverage: ['2026-01-01', '2026-12-31'],
  tags: 'home',
};

describe('stored values of the wrong shape', () => {
  let database: TestDatabase;
  let landlord: string;

  const titles = async (query: Readonly<Record<string, unknown>>) => {
    const result = await runQuery({ type: 'sample', ...query }, { db: database.db });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    if (!('rows' in result.value)) throw new Error('The query answered groups');
    return result.value.rows.map(({ title }) => title);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    const created = await createType(
      { slug: 'sample', description: 'A synthetic type', fields: FIELDS },
      { db, embedder: createFakeEmbedder(), schemaLanguage: 'en' },
    );
    if (!created.ok) throw new Error(created.error.message);
    const [entity] = await db
      .insert(entities)
      .values({ kind: 'person', canonicalName: 'Jane Doe' })
      .returning();
    if (entity === undefined) throw new Error('No entity inserted');
    landlord = entity.id;
    const add = (
      title: string,
      fields: Record<string, unknown>,
      provenance: Record<string, unknown> = {},
    ) => insertSyntheticDocument(db, { typeId: created.value.id, title, fields, provenance });
    await add(
      'right',
      {
        note: 'A note',
        energy: 'gas',
        quantity: 12,
        paid: true,
        signed_on: '2026-02-28',
        landlord: 'Mrs Jane Doe',
        deposit: { value: 12, currency: 'EUR' },
        coverage: { start: '2026-01-01', end: '2026-12-31' },
        tags: ['home'],
      },
      { landlord: { entity_id: landlord } },
    );
    await add('wrong', WRONG, { landlord: { entity_id: [landlord] } });
    await add(
      'wrong parts',
      {
        landlord: 'Jane Doe',
        deposit: { value: '12', currency: 978 },
        coverage: { start: 20260101, end: 'later' },
      },
      { landlord },
    );
    for (const date of ['today', '8 January 2026', '2026-1-5', '20260105', 'infinity']) {
      await add(`dated ${date}`, { signed_on: date });
    }
    const scalar = await add('not objects', {});
    await db.execute(
      sql`UPDATE documents SET core = '[1, 2]'::jsonb, fields = '"oops"'::jsonb, provenance = '[3]'::jsonb WHERE id = ${scalar.id}`,
    );
  });

  afterAll(async () => {
    await database.dispose();
  });

  it.each([
    ['fields.note', 'contains', 'note'],
    ['fields.note', '=', 'A note'],
    ['fields.energy', '=', 'gas'],
    ['fields.quantity', '>=', 12],
    ['fields.quantity', 'in', [12]],
    ['fields.paid', '=', true],
    ['fields.signed_on', '>=', '2000-01-01'],
    ['fields.signed_on', '<', '2100-01-01'],
    ['fields.deposit.value', '=', 12],
    ['fields.deposit.currency', 'contains', 'e'],
    ['fields.coverage.start', '<=', '2026-01-01'],
    ['fields.coverage.end', '>', '2000-01-01'],
    ['fields.tags', 'contains', 'home'],
  ])('%s %s %j skips them instead of failing', async (path, operator, value) => {
    expect(await titles({ where: [[path, operator, value]] })).toEqual(['right']);
  });

  it('compares an entity through a provenance of the right shape only', async () => {
    expect(await titles({ where: [['fields.landlord', '=', 'Jane Doe']] })).toEqual(['right']);
    expect(await titles({ where: [['fields.landlord', '=', landlord]] })).toEqual(['right']);
    expect(await titles({ where: [['fields.landlord', 'exists', true]] })).toEqual([
      'right',
      'wrong parts',
    ]);
    expect(
      await titles({ where: [['fields.landlord', '!=', 'Jane Doe']], limit: 200 }),
    ).toHaveLength(8);
  });

  it.each(Object.keys(WRONG))('reads a wrong %s as absent', async (name) => {
    const path = `fields.${name}`;
    const among = ['title', 'in', ['right', 'wrong']];
    expect(await titles({ where: [among, [path, 'exists', true]] })).toEqual(['right']);
    expect(await titles({ where: [among, [path, 'exists', false]] })).toEqual(['wrong']);
  });

  it('reads as a date only what is written as one', async () => {
    expect(await titles({ where: [['fields.signed_on', 'exists', false]], limit: 200 })).toEqual([
      'wrong',
      'wrong parts',
      'dated today',
      'dated 8 January 2026',
      'dated 2026-1-5',
      'dated 20260105',
      'dated infinity',
      'not objects',
    ]);
  });

  it('reads the wrong parts of an amount or a period as absent, and the whole as present', async () => {
    const parts = { where: [['title', '=', 'wrong parts']] };
    for (const path of ['deposit.value', 'deposit.currency', 'coverage.start', 'coverage.end']) {
      expect(
        await titles({ where: [...parts.where, [`fields.${path}`, 'exists', false]] }),
      ).toEqual(['wrong parts']);
    }
    expect(await titles({ where: [...parts.where, ['fields.deposit', 'exists', true]] })).toEqual([
      'wrong parts',
    ]);
  });

  it('orders them last and leaves them out of the aggregates', async () => {
    const some = { where: [['title', 'in', ['right', 'wrong']]] };
    for (const direction of ['asc', 'desc']) {
      for (const path of ['fields.quantity', 'fields.signed_on', 'fields.note', 'fields.paid']) {
        expect(await titles({ ...some, order_by: [path, direction] })).toEqual(['right', 'wrong']);
      }
    }
    const result = await runQuery(
      {
        type: 'sample',
        aggregate: { count: '*', sum: 'fields.quantity', max: 'fields.signed_on' },
        group_by: ['fields.paid'],
      },
      { db: database.db },
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        groups: [
          { key: { 'fields.paid': true }, values: { count: 1, sum: 12, max: '2026-02-28' } },
          { key: { 'fields.paid': null }, values: { count: 8, sum: null, max: null } },
        ],
      },
    });
  });

  it('returns a core and fields that are not objects as empty', async () => {
    const result = await runQuery(
      { type: 'sample', where: [['title', '=', 'not objects']], select: ['fields.note'] },
      { db: database.db },
    );
    if (!result.ok || !('rows' in result.value)) throw new Error('The query failed');
    expect(result.value.rows.map(({ title, core, fields }) => ({ title, core, fields }))).toEqual([
      { title: 'not objects', core: {}, fields: {} },
    ]);
  });

  it('reads and writes dates as ISO 8601 whatever the date style of the database', async () => {
    const name = new URL(database.url).pathname.slice(1);
    await database.db.execute(
      sql`ALTER DATABASE ${sql.identifier(name)} SET datestyle TO 'German, DMY'`,
    );
    const german = createDb(database.url);
    try {
      const [style] = await german.db.execute(sql`SHOW datestyle`);
      expect(style).toEqual({ DateStyle: 'German, DMY' });
      const result = await runQuery(
        {
          type: 'sample',
          where: [['fields.signed_on', '>=', '2026-02-28']],
          aggregate: { max: 'fields.signed_on' },
          group_by: ['fields.signed_on'],
        },
        { db: german.db },
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          groups: [{ key: { 'fields.signed_on': '2026-02-28' }, values: { max: '2026-02-28' } }],
        },
      });
    } finally {
      await german.close();
      await database.db.execute(sql`ALTER DATABASE ${sql.identifier(name)} RESET datestyle`);
    }
  });

  it('returns a stored value as it is, whatever its shape', async () => {
    const result = await runQuery(
      {
        type: 'sample',
        where: [['title', '=', 'wrong']],
        select: ['fields.quantity', 'fields.tags'],
      },
      { db: database.db },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { rows: [{ fields: { quantity: '12', tags: 'home' } }] },
    });
  });
});
