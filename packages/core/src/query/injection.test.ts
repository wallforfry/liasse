import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { entities } from '../db/schema/registry.ts';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { checkQuery } from './check.ts';
import { compileQuery } from './compile.ts';
import { parseQueryDsl } from './dsl.ts';
import { queryFields } from './fields.ts';
import { runQuery } from './run.ts';

const HOSTILE = [
  `'; DROP TABLE documents; --`,
  `" OR 1=1 --`,
  `') OR ('1'='1`,
  `$$; DROP TABLE documents; $$`,
  `\\'; SELECT pg_sleep(10); --`,
  `core.issuer'::text; DELETE FROM documents; --`,
  `%' UNION SELECT sha256 FROM documents --`,
  `{}'::jsonb) IS NOT NULL OR (TRUE`,
] as const;

const NOTE_FIELDS = {
  note: { type: 'text' },
  other_note: { type: 'text' },
  quantity: { type: 'number' },
  second_quantity: { type: 'number' },
  owner: { type: 'entity' },
  tags: { type: 'list', items: { type: 'text' } },
  deposit: { type: 'money' },
} as const;

const dialect = new PgDialect();

const compiled = (
  input: unknown,
  entityIds: ReadonlyMap<string, readonly string[]> = new Map(),
) => {
  const dsl = parseQueryDsl(input);
  if (!dsl.ok) throw new Error(JSON.stringify(dsl.error));
  const checked = checkQuery(dsl.value, queryFields({ fields: NOTE_FIELDS }));
  if (!checked.ok) throw new Error(JSON.stringify(checked.error));
  const { sql: text, params } = dialect.sqlToQuery(
    compileQuery(checked.value, { entityIds, typeId: 'typ_synthetic' }),
  );
  return { text, params };
};

// Every way a text of the query can reach a statement, each with a harmless twin of the
// same shape.
const POSITIONS: Readonly<Record<string, (text: string) => unknown>> = {
  'a compared text': (text) => ({ where: [['fields.note', '=', text]] }),
  'an excluded text': (text) => ({ where: [['fields.note', '!=', text]] }),
  'a listed text': (text) => ({ where: [['fields.note', 'in', [text]]] }),
  'a searched text': (text) => ({ where: [['fields.note', 'contains', text]] }),
  'a list item': (text) => ({ where: [['fields.tags', 'contains', text]] }),
  'a title': (text) => ({ where: [['title', '=', text]], order_by: ['title', 'desc'] }),
  'a grouped filter': (text) => ({
    where: [['fields.note', '=', text]],
    aggregate: { count: '*', sum: 'fields.quantity' },
    group_by: ['fields.note'],
  }),
};

describe('what reaches the statement', () => {
  it('binds every field name and every value of the query', () => {
    const { text, params } = compiled(
      {
        where: [
          ['core.issuer', '=', 'EDF'],
          ['core.document_date', '>=', '2026-01-01'],
          ['fields.quantity', '>', 300],
          ['fields.note', 'contains', 'needle'],
          ['fields.tags', 'contains', 'home'],
        ],
        order_by: ['fields.second_quantity', 'desc'],
        limit: 7,
        offset: 3,
      },
      new Map([['EDF', ['ent_synthetic']]]),
    );
    for (const word of [
      'EDF',
      'ent_synthetic',
      'issuer',
      'entity_id',
      'document_date',
      '2026-01-01',
      'quantity',
      '300',
      'note',
      'needle',
      'tags',
      'home',
      'typ_synthetic',
      'deleted',
      'merged',
    ]) {
      expect(text).not.toContain(word);
    }
    expect(params).toEqual([
      'merged',
      'merged',
      'deleted',
      'typ_synthetic',
      'issuer',
      'entity_id',
      'issuer',
      'entity_id',
      'ent_synthetic',
      ...Array.from({ length: 4 }, () => 'document_date'),
      '2026-01-01',
      'quantity',
      'quantity',
      300,
      'note',
      'note',
      'needle',
      'tags',
      'tags',
      '["home"]',
      'second_quantity',
      'second_quantity',
      8,
      3,
    ]);
  });

  it('writes a statement that depends on the shape of the query, not on its names or values', () => {
    const first = compiled({
      where: [
        ['fields.note', '=', 'one'],
        ['fields.quantity', '<', 1],
      ],
      aggregate: { sum: 'fields.quantity', max: 'fields.second_quantity' },
      group_by: ['fields.note'],
    });
    const second = compiled({
      where: [
        ['fields.other_note', '=', 'another value'],
        ['fields.second_quantity', '<', 99999],
      ],
      aggregate: { sum: 'fields.second_quantity', max: 'fields.quantity' },
      group_by: ['fields.other_note'],
      limit: 3,
      offset: 12,
    });
    expect(second.text).toBe(first.text);
    expect(second.params).not.toEqual(first.params);
    const rows = compiled({ select: ['fields.note'], order_by: ['fields.note', 'asc'] });
    const otherRows = compiled({
      select: ['fields.quantity', 'status'],
      order_by: ['title', 'asc'],
    });
    expect(rows.text).not.toBe(first.text);
    expect(otherRows.text.replaceAll(/\$\d+/g, '$')).not.toBe(rows.text.replaceAll(/\$\d+/g, '$'));
  });

  describe.each(Object.entries(POSITIONS))('with %s', (_, build) => {
    it.each(HOSTILE)('binds %j', (hostile) => {
      const harmless = compiled(build('harmless'));
      const attacked = compiled(build(hostile));
      expect(attacked.text).toBe(harmless.text);
      expect(attacked.text).not.toContain(hostile);
      expect(JSON.stringify(attacked.params)).toContain(JSON.stringify(hostile).slice(1, -1));
    });
  });

  it.each(HOSTILE)('binds %j as an entity name and as an entity id', (hostile) => {
    const build = (name: string, ids: readonly string[]) =>
      compiled({ where: [['fields.owner', '=', name]] }, new Map([[name, ids]]));
    expect(build(hostile, [hostile]).text).toBe(build('harmless', ['ent_harmless']).text);
    expect(build(hostile, []).text).not.toContain(hostile);
  });

  describe('against a database', () => {
    let database: TestDatabase;

    const run = (query: unknown) => runQuery(query, { db: database.db });

    beforeAll(async () => {
      database = await createTestDatabase();
      const { db } = database;
      const created = await createType(
        { slug: 'memo', description: 'A synthetic memo', fields: NOTE_FIELDS },
        { db, embedder: createFakeEmbedder(), maxNewTypesPerDay: 10, schemaLanguage: 'en' },
      );
      if (!created.ok) throw new Error(created.error.message);
      await db.insert(entities).values({ kind: 'org', canonicalName: 'Synthetic Owner' });
      for (const hostile of HOSTILE) {
        await insertSyntheticDocument(db, {
          typeId: created.value.id,
          title: hostile,
          fields: { note: hostile, tags: [hostile] },
        });
      }
    });

    afterAll(async () => {
      await database.dispose();
    });

    it.each(HOSTILE)('finds the documents that hold %j, and nothing else', async (hostile) => {
      for (const where of [
        [['title', '=', hostile]],
        [['fields.note', '=', hostile]],
        [['fields.note', 'in', [hostile]]],
        [['fields.note', 'contains', hostile]],
        [['fields.tags', 'contains', hostile]],
      ]) {
        const result = await run({ type: 'memo', where });
        expect(result).toMatchObject({ ok: true, value: { rows: [{ title: hostile }] } });
      }
      expect(await run({ type: 'memo', where: [['fields.owner', '=', hostile]] })).toMatchObject({
        ok: true,
        value: { rows: [], warnings: [{ code: 'unknown_entity' }] },
      });
      expect(await database.db.$count(documents)).toBe(HOSTILE.length);
    });

    it.each(HOSTILE)('refuses %j wherever a name is expected', async (hostile) => {
      const refused = async (query: unknown, code: string) => {
        const result = await run(query);
        expect(result).toMatchObject({ ok: false, error: [{ code }] });
        expect(JSON.stringify(result)).not.toMatch(/SELECT "|FROM "|jsonb_/);
      };
      await refused({ type: hostile }, 'unknown_type');
      await refused({ where: [[hostile, '=', 'x']] }, 'unknown_field');
      await refused(
        { where: [[`fields.note.${hostile}`, '=', 'x']], type: 'memo' },
        'unknown_field',
      );
      await refused({ where: [['title', hostile, 'x']] }, 'invalid_query');
      await refused({ order_by: [hostile, 'asc'] }, 'unknown_field');
      await refused({ order_by: ['title', hostile] }, 'invalid_query');
      await refused({ select: [hostile] }, 'unknown_field');
      await refused({ aggregate: { count: hostile } }, 'unknown_field');
      await refused({ aggregate: { [hostile]: 'title' } }, 'invalid_query');
      await refused({ aggregate: { count: '*' }, group_by: [hostile] }, 'unknown_field');
      await refused({ limit: hostile }, 'invalid_query');
      await refused({ offset: hostile }, 'invalid_query');
      await refused({ include_private: hostile }, 'invalid_query');
      await refused({ [hostile]: 1 }, 'invalid_query');
      await refused({ where: [['core.document_date', '>=', hostile]] }, 'invalid_literal');
      await refused({ where: [['confidence', '>', hostile]] }, 'invalid_literal');
      await refused({ where: [['core.amount.currency', '=', hostile]] }, 'invalid_literal');
      await refused({ where: [['status', '=', hostile]] }, 'invalid_literal');
      await refused({ where: [['private', '=', hostile]] }, 'invalid_literal');
      expect(await database.db.$count(documents)).toBe(HOSTILE.length);
    });
  });
});
