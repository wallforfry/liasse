import { parseQueryDsl } from '@liasse/contract/query';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { entities } from '../db/schema/registry.ts';
import { createType } from '../registry/create-type.ts';
import { resolveType } from '../registry/read-types.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { checkQuery } from './check.ts';
import { compileQuery } from './compile.ts';
import { queryFields } from './fields.ts';
import { runQuery } from './run.ts';

const COMMON_TYPE_DOCUMENTS = 3000;
const RARE_TYPE_DOCUMENTS = 30;
const ISSUERS = 20;

const BILL_FIELDS = { consumption_kwh: { type: 'number' } } as const;

const day = (index: number): string =>
  new Date(Date.UTC(2025, 0, 1 + (index % 700))).toISOString().slice(0, 10);

const consumption = (index: number): number => 100 + (index % 500);

describe('the plan of the common filtered query', () => {
  let database: TestDatabase;
  const issuers: string[] = [];

  const filtered = (type: string) => ({
    type,
    where: [
      ['core.issuer', '=', issuers[3]],
      ['core.document_date', '>=', '2026-01-01'],
      ['fields.consumption_kwh', '>', 300],
    ],
    order_by: ['core.document_date', 'desc'],
    limit: 50,
  });

  const planOf = async (query: ReturnType<typeof filtered>): Promise<string> => {
    const { db } = database;
    const dsl = parseQueryDsl(query);
    const type = await resolveType(query.type, { db });
    if (!dsl.ok || type === undefined) throw new Error('The fixture query is not valid');
    const checked = checkQuery(dsl.value, queryFields(type));
    if (!checked.ok) throw new Error(JSON.stringify(checked.error));
    const statement = compileQuery(checked.value, {
      typeId: type.id,
      entityIds: new Map([[issuers[3] ?? '', [issuers[3] ?? '']]]),
    });
    const plan = await db.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
    return JSON.stringify(plan);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    const context = {
      db,
      embedder: createFakeEmbedder(),
      schemaLanguage: 'en',
    } as const;
    const create = async (slug: string) => {
      const created = await createType(
        { slug, description: `Synthetic ${slug}`, fields: BILL_FIELDS },
        context,
      );
      if (!created.ok) throw new Error(created.error.message);
      return created.value.id;
    };
    const common = await create('energy_bill');
    const rare = await create('meter_notice');
    const created = await db
      .insert(entities)
      .values(
        Array.from({ length: ISSUERS }, (_, index) => ({
          kind: 'org' as const,
          canonicalName: `Synthetic Supplier ${String(index)}`,
        })),
      )
      .returning({ id: entities.id });
    issuers.push(...created.map(({ id }) => id));
    const rows = (typeId: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        sha256: `synthetic-${typeId}-${String(index)}`,
        storageKey: `synthetic/${typeId}/${String(index)}`,
        mime: 'application/pdf',
        originalName: `synthetic-${String(index)}.pdf`,
        source: 'api' as const,
        typeId,
        title: `Synthetic bill ${String(index)}`,
        core: {
          issuer: `Synthetic Supplier ${String(index % ISSUERS)}`,
          document_date: day(index),
          amount: { value: 20 + (index % 180), currency: 'EUR' },
        },
        provenance: { issuer: { entity_id: issuers[index % ISSUERS] } },
        fields: { consumption_kwh: consumption(index) },
      }));
    await db.insert(documents).values(rows(common, COMMON_TYPE_DOCUMENTS));
    await db.insert(documents).values(rows(rare, RARE_TYPE_DOCUMENTS));
    await db.execute(sql`ANALYZE`);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('answers the filtered query over a few thousand documents', async () => {
    const expected = Array.from({ length: COMMON_TYPE_DOCUMENTS }, (_, index) => index).filter(
      (index) => index % ISSUERS === 3 && day(index) >= '2026-01-01' && consumption(index) > 300,
    );
    const result = await runQuery(filtered('energy_bill'), { db: database.db });
    if (!result.ok || !('rows' in result.value)) throw new Error('The query failed');
    expect(expected.length).toBeGreaterThan(10);
    expect(result.value.rows).toHaveLength(expected.length);
    expect(result.value.rows[0]?.core).toMatchObject({ issuer: 'Synthetic Supplier 3' });
  });

  // Measured on Postgres 16 with these 3030 documents: the type is resolved first, its
  // documents come from `documents_type_id_idx`, and the other conditions filter them in
  // about a millisecond. No other index is needed at this size; a GIN index on `core`
  // could not serve these conditions anyway, since they compare typed values, not JSON.
  it.each(['energy_bill', 'meter_notice'])(
    'reads the documents of %s through the index on type_id',
    async (type) => {
      const plan = await planOf(filtered(type));
      expect(plan).toContain('"Index Name":"documents_type_id_idx"');
      expect(plan).not.toMatch(/"Node Type":"Seq Scan"[^{}]*"Relation Name":"documents"/);
    },
  );
});
