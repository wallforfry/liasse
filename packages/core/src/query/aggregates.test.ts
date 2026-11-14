import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { QueryPrimitive } from './capabilities.ts';
import { AGGREGATE_FUNCTIONS, type AggregateFunction } from './dsl.ts';
import { runQuery } from './run.ts';

const INVOICE_FIELDS = {
  note: { type: 'text' },
  order_number: { type: 'identifier' },
  category: { type: 'enum', values: ['goods', 'services'] },
  quantity: { type: 'number' },
  paid: { type: 'boolean' },
  due_on: { type: 'date' },
  vendor: { type: 'entity' },
  deposit: { type: 'money' },
  coverage: { type: 'period' },
  tags: { type: 'list', items: { type: 'text' } },
} as const;

const PATHS = {
  text: 'fields.note',
  identifier: 'fields.order_number',
  enum: 'fields.category',
  number: 'fields.quantity',
  boolean: 'fields.paid',
  date: 'fields.due_on',
  entity: 'fields.vendor',
  money: 'fields.deposit',
  period: 'fields.coverage',
  list: 'fields.tags',
  key_dates: 'core.key_dates',
} as const satisfies Record<QueryPrimitive, string>;

// Written out, not read from the capability table: this is what the table must say.
const AGGREGATES: Readonly<Record<QueryPrimitive, readonly AggregateFunction[]>> = {
  text: ['count'],
  identifier: ['count'],
  enum: ['count'],
  number: ['count', 'sum', 'min', 'max', 'avg'],
  boolean: ['count'],
  date: ['count', 'min', 'max'],
  entity: ['count'],
  money: ['count'],
  period: ['count'],
  list: ['count'],
  key_dates: ['count'],
};

const GROUPABLE: readonly QueryPrimitive[] = [
  'text',
  'identifier',
  'enum',
  'number',
  'boolean',
  'date',
  'entity',
];

const PRIMITIVES = Object.keys(PATHS).filter((name): name is QueryPrimitive => name in AGGREGATES);

const REJECTED = PRIMITIVES.flatMap((primitive) =>
  AGGREGATE_FUNCTIONS.filter((fn) => !AGGREGATES[primitive].includes(fn)).map(
    (fn) => [fn, primitive] as const,
  ),
);

const CURRENCY_WARNING = (path: string) => ({
  code: 'implicit_currency_grouping',
  path: ['group_by'],
  message: `Amounts in different currencies cannot be aggregated together: the result is also grouped by ${path}.`,
});

describe('aggregates', () => {
  let database: TestDatabase;
  const vendors: Record<string, string> = {};

  const run = (query: Readonly<Record<string, unknown>>) =>
    runQuery({ type: 'invoice', ...query }, { db: database.db });

  const groupsOf = async (query: Readonly<Record<string, unknown>>) => {
    const result = await run(query);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    if (!('groups' in result.value)) throw new Error('The query answered rows');
    return result.value;
  };

  const errorsOf = async (query: Readonly<Record<string, unknown>>) => {
    const result = await run(query);
    if (result.ok) throw new Error('The query was accepted');
    return result.error;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    const created = await createType(
      { slug: 'invoice', description: 'A synthetic invoice', fields: INVOICE_FIELDS },
      { db, embedder: createFakeEmbedder(), maxNewTypesPerDay: 10, schemaLanguage: 'en' },
    );
    if (!created.ok) throw new Error(created.error.message);
    const [first, second] = await db
      .insert(entities)
      .values([
        { kind: 'org', canonicalName: 'Northwind Traders' },
        { kind: 'org', canonicalName: 'Contoso Supplies' },
      ])
      .returning();
    if (first === undefined || second === undefined) throw new Error('No entity inserted');
    Object.assign(vendors, { first: first.id, second: second.id });
    // Each document writes the name of its issuer its own way: only the id in the
    // provenance says that two of them are the same entity.
    const invoice = (
      issuer: string | undefined,
      core: Record<string, unknown>,
      fields: Record<string, unknown>,
      isPrivate = false,
    ) =>
      insertSyntheticDocument(db, {
        typeId: created.value.id,
        core:
          issuer === undefined ? core : { ...core, issuer: `Issuer of ${JSON.stringify(core)}` },
        fields,
        provenance: {
          ...(issuer === undefined ? {} : { issuer: { entity_id: issuer } }),
          ...('vendor' in fields ? { vendor: { entity_id: first.id } } : {}),
        },
        private: isPrivate,
      });
    await invoice(
      first.id,
      { document_date: '2026-01-10', amount: { value: 100, currency: 'EUR' } },
      {
        note: 'beta',
        quantity: 2,
        category: 'goods',
        paid: true,
        due_on: '2026-02-10',
        vendor: 'Northwind',
        deposit: { value: 10, currency: 'CHF' },
      },
    );
    await invoice(
      first.id,
      { document_date: '2026-02-10', amount: { value: 50, currency: 'EUR' } },
      { note: 'Alpha', quantity: 4, category: 'services', paid: false, due_on: '2026-03-10' },
    );
    await invoice(
      second.id,
      { document_date: '2026-03-10', amount: { value: 30, currency: 'USD' } },
      { note: 'beta', quantity: 6, category: 'goods', paid: true, due_on: '2026-02-10' },
    );
    await invoice(
      second.id,
      { document_date: '2026-01-20', amount: { value: 20, currency: 'EUR' } },
      { category: 'goods' },
    );
    await invoice(undefined, {}, { quantity: 10 });
    await invoice(
      first.id,
      { amount: { value: 5000, currency: 'EUR' } },
      { quantity: 1000, category: 'goods' },
      true,
    );
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('counts documents, or the documents that have a value', async () => {
    expect(await groupsOf({ aggregate: { count: '*' } })).toEqual({
      groups: [{ key: {}, values: { count: 5 } }],
      has_more: false,
      warnings: [],
    });
    expect((await groupsOf({ aggregate: { count: PATHS.number } })).groups).toEqual([
      { key: {}, values: { count: 4 } },
    ]);
    expect((await groupsOf({ aggregate: { count: 'core.amount' } })).groups).toEqual([
      { key: {}, values: { count: 4 } },
    ]);
  });

  it('computes each aggregate over the filtered documents', async () => {
    const one = async (aggregate: Record<string, string>, where: readonly unknown[] = []) =>
      (await groupsOf({ aggregate, where })).groups;
    expect(await one({ sum: PATHS.number })).toEqual([{ key: {}, values: { sum: 22 } }]);
    expect(await one({ min: PATHS.number })).toEqual([{ key: {}, values: { min: 2 } }]);
    expect(await one({ max: PATHS.number })).toEqual([{ key: {}, values: { max: 10 } }]);
    expect(await one({ avg: PATHS.number })).toEqual([{ key: {}, values: { avg: 5.5 } }]);
    expect(await one({ min: 'core.document_date' })).toEqual([
      { key: {}, values: { min: '2026-01-10' } },
    ]);
    expect(await one({ max: 'core.document_date' })).toEqual([
      { key: {}, values: { max: '2026-03-10' } },
    ]);
    expect(await one({ sum: PATHS.number }, [[PATHS.enum, '=', 'goods']])).toEqual([
      { key: {}, values: { sum: 8 } },
    ]);
    expect(
      await one({
        count: '*',
        sum: PATHS.number,
        min: PATHS.date,
        max: PATHS.number,
        avg: PATHS.number,
      }),
    ).toEqual([{ key: {}, values: { count: 5, sum: 22, min: '2026-02-10', max: 10, avg: 5.5 } }]);
  });

  it('answers one group of nulls and a zero count over no document', async () => {
    const nothing = [[PATHS.number, '>', 100000]];
    expect(
      (
        await groupsOf({
          aggregate: { count: '*', sum: PATHS.number, min: PATHS.date },
          where: nothing,
        })
      ).groups,
    ).toEqual([{ key: {}, values: { count: 0, sum: null, min: null } }]);
    expect(
      (await groupsOf({ aggregate: { count: '*' }, group_by: [PATHS.enum], where: nothing }))
        .groups,
    ).toEqual([]);
  });

  it('groups by one path, groups in the order of their key and the missing key last', async () => {
    const grouped = await groupsOf({
      aggregate: {
        count: '*',
        sum: PATHS.number,
        min: PATHS.number,
        max: PATHS.number,
        avg: PATHS.number,
      },
      group_by: [PATHS.enum],
    });
    expect(grouped.groups).toEqual([
      { key: { [PATHS.enum]: 'goods' }, values: { count: 3, sum: 8, min: 2, max: 6, avg: 4 } },
      { key: { [PATHS.enum]: 'services' }, values: { count: 1, sum: 4, min: 4, max: 4, avg: 4 } },
      { key: { [PATHS.enum]: null }, values: { count: 1, sum: 10, min: 10, max: 10, avg: 10 } },
    ]);
    expect(grouped.warnings).toEqual([]);
  });

  it('groups by several paths', async () => {
    const { groups } = await groupsOf({
      aggregate: { count: '*' },
      group_by: [PATHS.enum, PATHS.boolean],
    });
    expect(groups).toEqual([
      { key: { [PATHS.enum]: 'goods', [PATHS.boolean]: true }, values: { count: 2 } },
      { key: { [PATHS.enum]: 'goods', [PATHS.boolean]: null }, values: { count: 1 } },
      { key: { [PATHS.enum]: 'services', [PATHS.boolean]: false }, values: { count: 1 } },
      { key: { [PATHS.enum]: null, [PATHS.boolean]: null }, values: { count: 1 } },
    ]);
  });

  it('gives each key in the form of its primitive', async () => {
    const keys = async (path: string) =>
      (await groupsOf({ aggregate: { count: '*' }, group_by: [path] })).groups.map(
        ({ key, values }) => [key[path], values.count],
      );
    expect(await keys(PATHS.text)).toEqual([
      ['Alpha', 1],
      ['beta', 2],
      [null, 2],
    ]);
    expect(await keys(PATHS.number)).toEqual([
      [2, 1],
      [4, 1],
      [6, 1],
      [10, 1],
      [null, 1],
    ]);
    expect(await keys(PATHS.boolean)).toEqual([
      [false, 1],
      [true, 2],
      [null, 2],
    ]);
    expect(await keys(PATHS.date)).toEqual([
      ['2026-02-10', 2],
      ['2026-03-10', 1],
      [null, 2],
    ]);
    expect(await keys('core.issuer')).toEqual([
      [vendors.first, 2],
      [vendors.second, 2],
      [null, 1],
    ]);
    expect(await keys('core.amount.currency')).toEqual([
      ['EUR', 3],
      ['USD', 1],
      [null, 1],
    ]);
    expect(await keys('type')).toEqual([['invoice', 5]]);
  });

  it.each(GROUPABLE)('groups by a %s field', async (primitive) => {
    expect((await run({ aggregate: { count: '*' }, group_by: [PATHS[primitive]] })).ok).toBe(true);
  });

  it.each(PRIMITIVES.filter((primitive) => !GROUPABLE.includes(primitive)))(
    'refuses to group by a %s field',
    async (primitive) => {
      expect(
        await errorsOf({ aggregate: { count: '*' }, group_by: ['title', PATHS[primitive]] }),
      ).toMatchObject([{ code: 'not_groupable', path: ['group_by', 1] }]);
    },
  );

  it('groups the aggregates of an amount by its currency, and says so', async () => {
    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      const implicit = await groupsOf({ aggregate: { [fn]: 'core.amount.value' } });
      expect(implicit.groups.map(({ key }) => key)).toEqual([
        { 'core.amount.currency': 'EUR' },
        { 'core.amount.currency': 'USD' },
        { 'core.amount.currency': null },
      ]);
      expect(implicit.warnings).toEqual([CURRENCY_WARNING('core.amount.currency')]);
    }
    expect((await groupsOf({ aggregate: { sum: 'core.amount.value' } })).groups).toEqual([
      { key: { 'core.amount.currency': 'EUR' }, values: { sum: 170 } },
      { key: { 'core.amount.currency': 'USD' }, values: { sum: 30 } },
      { key: { 'core.amount.currency': null }, values: { sum: null } },
    ]);
    const typeField = await groupsOf({
      aggregate: { sum: 'fields.deposit.value' },
      where: [['fields.deposit', 'exists', true]],
    });
    expect(typeField.groups).toEqual([
      { key: { 'fields.deposit.currency': 'CHF' }, values: { sum: 10 } },
    ]);
    expect(typeField.warnings).toEqual([CURRENCY_WARNING('fields.deposit.currency')]);
  });

  it('adds the currency to the keys of a query that groups by something else', async () => {
    const byIssuer = await groupsOf({
      aggregate: { sum: 'core.amount.value', count: '*' },
      group_by: ['core.issuer'],
    });
    expect(byIssuer.groups).toEqual([
      {
        key: { 'core.issuer': vendors.first, 'core.amount.currency': 'EUR' },
        values: { count: 2, sum: 150 },
      },
      {
        key: { 'core.issuer': vendors.second, 'core.amount.currency': 'EUR' },
        values: { count: 1, sum: 20 },
      },
      {
        key: { 'core.issuer': vendors.second, 'core.amount.currency': 'USD' },
        values: { count: 1, sum: 30 },
      },
      {
        key: { 'core.issuer': null, 'core.amount.currency': null },
        values: { count: 1, sum: null },
      },
    ]);
    expect(byIssuer.warnings).toEqual([CURRENCY_WARNING('core.amount.currency')]);
  });

  it('adds nothing when the currency is a key already, or when amounts are only counted', async () => {
    const explicit = await groupsOf({
      aggregate: { sum: 'core.amount.value' },
      group_by: ['core.amount.currency'],
    });
    expect(explicit.groups).toHaveLength(3);
    expect(explicit.warnings).toEqual([]);
    const counted = await groupsOf({ aggregate: { count: 'core.amount.value' } });
    expect(counted).toMatchObject({ groups: [{ key: {}, values: { count: 4 } }], warnings: [] });
  });

  it.each(REJECTED)('refuses %s on a %s field and names its aggregates', async (fn, primitive) => {
    expect(await errorsOf({ aggregate: { [fn]: PATHS[primitive] } })).toMatchObject([
      { code: 'unsupported_aggregate', path: ['aggregate', fn], allowed: AGGREGATES[primitive] },
    ]);
  });

  it.each(
    PRIMITIVES.flatMap((primitive) => AGGREGATES[primitive].map((fn) => [fn, primitive] as const)),
  )('accepts %s on a %s field', async (fn, primitive) => {
    expect((await run({ aggregate: { [fn]: PATHS[primitive] } })).ok).toBe(true);
  });

  it('says which aggregates a field takes and where its parts are', async () => {
    expect(await errorsOf({ aggregate: { sum: PATHS.text } })).toEqual([
      {
        code: 'unsupported_aggregate',
        path: ['aggregate', 'sum'],
        allowed: ['count'],
        message: '"sum" does not apply to fields.note (text). Its aggregates: count.',
      },
    ]);
    const [money] = await errorsOf({ aggregate: { sum: 'core.amount' } });
    expect(money?.message).toBe(
      '"sum" does not apply to core.amount (money). Its aggregates: count. Address core.amount.value or core.amount.currency.',
    );
  });

  it('refuses a path it does not know, a select and a star outside count', async () => {
    expect(await errorsOf({ aggregate: { sum: 'fields.quantities' } })).toMatchObject([
      { code: 'unknown_field', path: ['aggregate', 'sum'], suggestion: 'fields.quantity' },
    ]);
    expect(
      await errorsOf({ aggregate: { count: '*' }, group_by: ['fields.categories'] }),
    ).toMatchObject([
      { code: 'unknown_field', path: ['group_by', 0], suggestion: 'fields.category' },
    ]);
    expect(await errorsOf({ aggregate: { sum: '*' } })).toMatchObject([
      { code: 'unknown_field', path: ['aggregate', 'sum'] },
    ]);
    expect(await errorsOf({ aggregate: { count: '*' }, select: ['title'] })).toEqual([
      {
        code: 'invalid_query',
        path: ['select'],
        message: '"select" does not apply to an "aggregate".',
      },
    ]);
  });

  it('checks an order_by it then ignores', async () => {
    const ordered = await groupsOf({ aggregate: { count: '*' }, order_by: ['title', 'desc'] });
    expect(ordered.warnings).toMatchObject([{ code: 'order_by_ignored', path: ['order_by'] }]);
    expect(await errorsOf({ aggregate: { count: '*' }, order_by: ['nope', 'desc'] })).toMatchObject(
      [{ code: 'unknown_field', path: ['order_by', 0] }],
    );
  });

  it('pages through the groups', async () => {
    const page = (limit: number, offset: number) =>
      groupsOf({ aggregate: { count: '*' }, group_by: [PATHS.number], limit, offset });
    const first = await page(2, 0);
    expect(first.groups.map(({ key }) => key[PATHS.number])).toEqual([2, 4]);
    expect(first.has_more).toBe(true);
    const last = await page(2, 4);
    expect(last.groups.map(({ key }) => key[PATHS.number])).toEqual([null]);
    expect(last.has_more).toBe(false);
  });

  it('aggregates private documents only when they are asked for', async () => {
    const withPrivate = await groupsOf({
      aggregate: { count: '*', sum: PATHS.number },
      include_private: true,
    });
    expect(withPrivate.groups).toEqual([{ key: {}, values: { count: 6, sum: 1022 } }]);
  });
});
