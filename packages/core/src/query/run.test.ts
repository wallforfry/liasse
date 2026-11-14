import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { entities } from '../db/schema/registry.ts';
import { createType } from '../registry/create-type.ts';
import { addAlias, markMerged } from '../registry/lifecycle.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { executeStatement } from './execute.ts';
import { runQuery } from './run.ts';

const BILL_FIELDS = {
  energy: { type: 'enum', values: ['electricity', 'gas', 'dual'] },
  meter_id: { type: 'identifier', format: 'PDL' },
  consumption_kwh: { type: 'number' },
  supply_address: { type: 'text' },
} as const;

const SPEC_EXAMPLE = {
  type: 'energy_bill',
  where: [
    ['core.issuer', '=', 'EDF'],
    ['core.document_date', '>=', '2026-01-01'],
    ['fields.consumption_kwh', '>', 300],
  ],
  order_by: ['core.document_date', 'desc'],
  aggregate: { sum: 'core.amount.value' },
  limit: 50,
};

const SPEC_FILTER = { type: SPEC_EXAMPLE.type, where: SPEC_EXAMPLE.where };

describe('runQuery', () => {
  let database: TestDatabase;
  const ids: Record<string, string> = {};

  const run = (query: unknown) => runQuery(query, { db: database.db });

  const rowsOf = async (query: unknown) => {
    const result = await run(query);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    if (!('rows' in result.value)) throw new Error('The query answered groups');
    return result.value;
  };

  const titles = async (query: unknown) => (await rowsOf(query)).rows.map(({ title }) => title);

  const errorsOf = async (query: unknown) => {
    const result = await run(query);
    if (result.ok) throw new Error('The query was accepted');
    return result.error;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    const context = {
      db,
      embedder: createFakeEmbedder(),
      maxNewTypesPerDay: 10,
      schemaLanguage: 'en',
    } as const;
    const create = async (slug: string, description: string, fields: unknown) => {
      const created = await createType({ slug, description, fields }, context);
      if (!created.ok) throw new Error(created.error.message);
      return created.value.id;
    };
    const energyBill = await create('energy_bill', 'Bill from an energy supplier', BILL_FIELDS);
    const gasBill = await create('gas_bill', 'Bill from a gas supplier', BILL_FIELDS);
    const payslip = await create('payslip', 'Monthly payslip', { net_pay: { type: 'money' } });
    await addAlias(energyBill, 'electricity_bill', context);
    const [edf, engie] = await db
      .insert(entities)
      .values([
        { kind: 'org', canonicalName: 'EDF', aliases: ['Électricité de France'] },
        { kind: 'org', canonicalName: 'Engie' },
      ])
      .returning();
    if (edf === undefined || engie === undefined) throw new Error('No entity inserted');
    const bill = async (
      title: string,
      typeId: string,
      issuer: { readonly id: string; readonly canonicalName: string },
      date: string,
      [value, currency]: readonly [number, string],
      consumption: number,
      isPrivate = false,
    ) => {
      const { id } = await insertSyntheticDocument(db, {
        typeId,
        title,
        private: isPrivate,
        // The name as each document writes it; the entity it stands for is in the provenance.
        core: {
          issuer: `${issuer.canonicalName} (${title})`,
          document_date: date,
          amount: { value, currency },
        },
        provenance: { issuer: { entity_id: issuer.id, match: 'alias', confidence: 0.99 } },
        fields: { consumption_kwh: consumption, energy: 'electricity', supply_address: title },
      });
      ids[title] = id;
    };
    await bill('february', energyBill, edf, '2026-02-10', [84.2, 'EUR'], 320);
    await bill('may', energyBill, edf, '2026-05-12', [120.5, 'EUR'], 410);
    await bill('last year', energyBill, edf, '2025-11-03', [60, 'EUR'], 500);
    await bill('low', energyBill, edf, '2026-03-01', [30, 'EUR'], 150);
    await bill('other issuer', energyBill, engie, '2026-04-01', [70, 'EUR'], 350);
    await bill('merged', gasBill, edf, '2026-06-01', [45, 'EUR'], 600);
    await bill('private', energyBill, edf, '2026-07-01', [999, 'EUR'], 900, true);
    await bill('deleted', energyBill, edf, '2026-08-01', [500, 'EUR'], 800);
    await bill('dollars', energyBill, edf, '2026-09-01', [10, 'USD'], 310);
    const slip = await insertSyntheticDocument(db, { typeId: payslip, title: 'payslip' });
    const untyped = await insertSyntheticDocument(db, { title: 'untyped' });
    Object.assign(ids, { payslip: slip.id, untyped: untyped.id });
    await markMerged(gasBill, energyBill, context);
    // The ingestion change adds this value to the enum; until it is merged the fixture does.
    await db.execute(sql`ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'deleted'`);
    await db.execute(sql`UPDATE documents SET status = 'deleted' WHERE id = ${ids.deleted}`);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('answers the example of the specification', async () => {
    expect(await run(SPEC_EXAMPLE)).toEqual({
      ok: true,
      value: {
        groups: [
          { key: { 'core.amount.currency': 'EUR' }, values: { sum: 249.7 } },
          { key: { 'core.amount.currency': 'USD' }, values: { sum: 10 } },
        ],
        has_more: false,
        warnings: [
          {
            code: 'implicit_currency_grouping',
            path: ['group_by'],
            message:
              'Amounts in different currencies cannot be aggregated together: the result is also grouped by core.amount.currency.',
          },
          {
            code: 'order_by_ignored',
            path: ['order_by'],
            message:
              '"order_by" orders rows and has no effect on an aggregate: groups come by their keys.',
          },
        ],
      },
    });
  });

  it('answers the rows of the same filter, ordered, with the core and no field', async () => {
    const {
      rows,
      has_more: hasMore,
      warnings,
    } = await rowsOf({
      ...SPEC_FILTER,
      order_by: SPEC_EXAMPLE.order_by,
    });
    expect(rows.map(({ title }) => title)).toEqual(['dollars', 'merged', 'may', 'february']);
    expect(rows[3]).toEqual({
      id: ids.february,
      type: 'energy_bill',
      title: 'february',
      core: {
        issuer: 'EDF (february)',
        document_date: '2026-02-10',
        amount: { value: 84.2, currency: 'EUR' },
      },
    });
    expect(hasMore).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('resolves an alias and a merged slug to the type, with the documents of the merged one', async () => {
    const expected = ['february', 'may', 'last year', 'low', 'other issuer', 'merged', 'dollars'];
    expect(await titles({ type: 'energy_bill' })).toEqual(expected);
    expect(await titles({ type: 'electricity_bill' })).toEqual(expected);
    expect(await titles({ type: 'gas_bill' })).toEqual(expected);
    const { rows } = await rowsOf({ type: 'gas_bill', where: [['title', '=', 'merged']] });
    expect(rows[0]?.type).toBe('energy_bill');
    expect(await titles({ type: 'payslip' })).toEqual(['payslip']);
  });

  it('refuses an unknown type', async () => {
    expect(await errorsOf({ type: 'water_bill' })).toEqual([
      {
        code: 'unknown_type',
        path: ['type'],
        message:
          'No type has the slug or the alias "water_bill". Leave "type" out to query every document on its core fields.',
      },
    ]);
  });

  it('queries every type on the core when no type is given', async () => {
    expect(await titles({ where: [['core.amount.value', '<', 50]] })).toEqual([
      'low',
      'merged',
      'dollars',
    ]);
    expect(await titles({ where: [['type', '=', 'energy_bill']], limit: 2, offset: 4 })).toEqual([
      'other issuer',
      'merged',
    ]);
    const { rows } = await rowsOf({ where: [['type', 'exists', false]] });
    expect(rows).toEqual([{ id: ids.untyped, type: null, title: 'untyped', core: {} }]);
    const [error] = await errorsOf({ where: [['fields.consumption_kwh', '>', 300]] });
    expect(error).toMatchObject({ code: 'unknown_field', path: ['where', 0, 0] });
    expect(error?.message).toContain('No type field exists here: give a "type" that defines it.');
  });

  it('leaves private documents out unless they are asked for', async () => {
    const recent = { type: 'energy_bill', where: [['core.document_date', '>=', '2026-07-01']] };
    expect(await titles(recent)).toEqual(['dollars']);
    expect(await titles({ ...recent, include_private: false })).toEqual(['dollars']);
    expect(await titles({ ...recent, include_private: true })).toEqual(['private', 'dollars']);
    expect(await titles({ ...recent, where: [['private', '=', true]] })).toEqual([]);
    expect(
      await titles({ ...recent, where: [['private', '=', true]], include_private: true }),
    ).toEqual(['private']);
  });

  it('never returns a deleted document', async () => {
    const everything = await titles({ include_private: true, limit: 200 });
    expect(everything).toHaveLength(10);
    expect(everything).not.toContain('deleted');
    expect(await titles({ where: [['id', '=', ids.deleted]], include_private: true })).toEqual([]);
    expect(await run({ aggregate: { count: '*' }, include_private: true })).toMatchObject({
      value: { groups: [{ key: {}, values: { count: 10 } }] },
    });
  });

  it('returns the selected fields and columns, and only those', async () => {
    const only = { type: 'energy_bill', where: [['title', '=', 'february']] };
    const { rows } = await rowsOf({
      ...only,
      select: [
        'fields.consumption_kwh',
        'fields.meter_id',
        'core.issuer',
        'status',
        'state',
        'ingested_at',
        'confidence',
        'private',
        'title',
      ],
    });
    const [stored] = await database.db
      .select({ ingestedAt: documents.ingestedAt })
      .from(documents)
      .where(eq(documents.id, ids.february ?? ''));
    expect(rows).toEqual([
      {
        id: ids.february,
        type: 'energy_bill',
        title: 'february',
        core: {
          issuer: 'EDF (february)',
          document_date: '2026-02-10',
          amount: { value: 84.2, currency: 'EUR' },
        },
        fields: { consumption_kwh: 320 },
        status: 'received',
        state: 'current',
        ingested_at: stored?.ingestedAt.toISOString(),
        confidence: null,
        private: false,
      },
    ]);
    const [selected] = (await rowsOf({ ...only, select: ['fields.supply_address'] })).rows;
    expect(selected?.fields).toEqual({ supply_address: 'february' });
    expect(selected).not.toHaveProperty('status');
    const [error] = await errorsOf({ ...only, select: ['title', 'fields.consumption'] });
    expect(error).toMatchObject({
      code: 'unknown_field',
      path: ['select', 1],
      suggestion: 'fields.consumption_kwh',
    });
  });

  it('selects the whole field a part belongs to', async () => {
    const { rows } = await rowsOf({ type: 'payslip', select: ['fields.net_pay.value'] });
    expect(rows[0]?.fields).toEqual({});
    await database.db
      .update(documents)
      .set({ fields: { net_pay: { value: 2100, currency: 'EUR' }, bonus: 1 } })
      .where(eq(documents.id, ids.payslip ?? ''));
    const again = await rowsOf({ type: 'payslip', select: ['fields.net_pay.value'] });
    expect(again.rows[0]?.fields).toEqual({ net_pay: { value: 2100, currency: 'EUR' } });
  });

  it('orders by a path in both directions, documents without a value last', async () => {
    const byDate = (direction: string) =>
      titles({
        where: [['core.amount.value', '<', 50]],
        order_by: ['core.document_date', direction],
      });
    expect(await byDate('asc')).toEqual(['low', 'merged', 'dollars']);
    expect(await byDate('desc')).toEqual(['dollars', 'merged', 'low']);
    const typeless = { where: [['title', 'in', ['low', 'untyped', 'payslip']]] };
    expect(await titles({ ...typeless, order_by: ['core.amount.value', 'asc'] })).toEqual([
      'low',
      'payslip',
      'untyped',
    ]);
    expect(await titles({ ...typeless, order_by: ['core.amount.value', 'desc'] })).toEqual([
      'low',
      'payslip',
      'untyped',
    ]);
    expect(
      await titles({ type: 'energy_bill', order_by: ['fields.consumption_kwh', 'desc'], limit: 3 }),
    ).toEqual(['merged', 'last year', 'may']);
  });

  it('orders text by its bytes and breaks ties by id', async () => {
    const some = { where: [['title', 'in', ['low', 'may', 'merged', 'Zeta']]] };
    await insertSyntheticDocument(database.db, { title: 'Zeta' });
    expect(await titles({ ...some, order_by: ['title', 'asc'] })).toEqual([
      'Zeta',
      'low',
      'may',
      'merged',
    ]);
    expect(await titles({ ...some, order_by: ['status', 'desc'] })).toEqual([
      'may',
      'low',
      'merged',
      'Zeta',
    ]);
    await database.db.delete(documents).where(eq(documents.title, 'Zeta'));
  });

  it('refuses to order by a field that has no order', async () => {
    expect(await errorsOf({ order_by: ['core.amount', 'asc'] })).toEqual([
      {
        code: 'not_sortable',
        path: ['order_by', 0],
        message:
          'core.amount (money) has no order. Address core.amount.value or core.amount.currency.',
      },
    ]);
    expect(await errorsOf({ order_by: ['core.issuer', 'asc'] })).toMatchObject([
      { code: 'not_sortable' },
    ]);
    expect(await errorsOf({ order_by: ['core.date', 'asc'] })).toMatchObject([
      { code: 'unknown_field', path: ['order_by', 0] },
    ]);
  });

  it('pages through the rows and says whether more remain', async () => {
    const page = (limit: number, offset: number) => rowsOf({ type: 'energy_bill', limit, offset });
    const first = await page(3, 0);
    expect(first.rows.map(({ title }) => title)).toEqual(['february', 'may', 'last year']);
    expect(first.has_more).toBe(true);
    const last = await page(3, 6);
    expect(last.rows.map(({ title }) => title)).toEqual(['dollars']);
    expect(last.has_more).toBe(false);
    expect((await page(7, 0)).has_more).toBe(false);
    expect((await page(6, 0)).has_more).toBe(true);
    expect((await rowsOf({ type: 'energy_bill' })).rows).toHaveLength(7);
  });

  it('reports the problems of every part of a query together', async () => {
    const errors = await errorsOf({
      where: [
        ['core.nope', '=', 1],
        ['core.document_date', '=', 'soon'],
      ],
      select: ['fields.nope'],
      group_by: ['title'],
    });
    expect(errors.map(({ code, path }) => [code, path])).toEqual([
      ['unknown_field', ['where', 0, 0]],
      ['invalid_literal', ['where', 1, 2]],
      ['invalid_query', ['group_by']],
      ['unknown_field', ['select', 0]],
    ]);
    expect(errors[2]?.message).toBe('"group_by" needs an "aggregate".');
  });

  it('stops a statement that runs past the timeout and says nothing of the storage', async () => {
    const { db } = database;
    const errors = await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE documents IN ACCESS EXCLUSIVE MODE`);
      return runQuery({}, { db, timeoutMilliseconds: 150 }).then((result) =>
        result.ok ? [] : result.error,
      );
    });
    expect(errors).toEqual([
      {
        code: 'timeout',
        path: [],
        message:
          'The query ran for more than 150 ms and was stopped. Narrow it with more conditions or a type.',
      },
    ]);
    expect(await titles({ type: 'payslip' })).toEqual(['payslip']);
  });

  it('leaves no timeout behind on the connections of the pool', async () => {
    const { db } = database;
    expect((await runQuery({}, { db, timeoutMilliseconds: 4321 })).ok).toBe(true);
    // Ten statements that overlap occupy every connection of the pool, the used one included.
    const settings = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.execute(sql`SELECT current_setting('statement_timeout') AS "timeout", pg_sleep(0.05)`),
      ),
    );
    expect(settings.map(([row]) => row?.timeout)).toEqual(Array.from({ length: 10 }, () => '0'));
  });

  it('runs the statement in a read-only transaction and throws what is not a timeout', async () => {
    const { db } = database;
    await expect(executeStatement(db, sql`DELETE FROM documents`, 1000)).rejects.toThrow();
    await expect(executeStatement(db, sql`SELECT 1 / 0`, 1000)).rejects.toThrow();
    expect(await db.$count(documents)).toBe(11);
    expect(await executeStatement(db, sql`SELECT 1 AS one`, 1000)).toEqual({
      ok: true,
      value: [{ one: 1 }],
    });
  });
});
