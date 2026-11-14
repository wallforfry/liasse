import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import {
  DEFAULT_QUERY_TIMEOUT_MILLISECONDS,
  MAX_QUERY_CONDITIONS,
  MAX_QUERY_ENTITIES,
  MAX_QUERY_ENTITY_NAME_LENGTH,
  MAX_QUERY_ENTITY_NAMES,
  MAX_QUERY_IN_VALUES,
  MAX_QUERY_REPORTED_PROBLEMS,
  MAX_QUERY_SUGGESTED_NAMES,
  MAX_QUERY_SUGGESTION_NAMES,
} from '../domain/limits.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { runQuery } from './run.ts';

const FEW_THOUSAND = 3000;

const supplier = (index: number) => ({
  kind: 'org' as const,
  canonicalName: `Synthetic Supplier ${String(index)}`,
  aliases: [`Synthetic Provider ${String(index)}`],
});

// The largest entity query the limits allow: every condition lists as many names as it
// may, each one unknown and each one close to thousands of entities.
const widestUnknownQuery = {
  where: Array.from({ length: MAX_QUERY_CONDITIONS }, (_, condition) => [
    'core.issuer',
    'in',
    Array.from(
      { length: MAX_QUERY_IN_VALUES },
      (_, value) => `Synthetic Supplier X${String(condition)}-${String(value)}`,
    ),
  ]),
  include_private: true,
};

describe('entity conditions against many entities', () => {
  let database: TestDatabase;
  let firstId: string;

  const addSuppliers = async (from: number, to: number) => {
    const rows = await database.db
      .insert(entities)
      .values(Array.from({ length: to - from }, (_, index) => supplier(from + index)))
      .returning({ id: entities.id });
    return rows;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const [first] = await addSuppliers(0, FEW_THOUSAND);
    if (first === undefined) throw new Error('No entity inserted');
    firstId = first.id;
    await insertSyntheticDocument(database.db, {
      title: 'from the first supplier',
      core: { issuer: 'Supplier zero' },
      provenance: { issuer: { entity_id: firstId } },
    });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('answers the widest query of unknown names well within the query timeout', async () => {
    const started = performance.now();
    const result = await runQuery(widestUnknownQuery, { db: database.db });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(DEFAULT_QUERY_TIMEOUT_MILLISECONDS);
    if (!result.ok || !('rows' in result.value)) throw new Error('The query failed');
    const { rows, warnings } = result.value;
    expect(rows).toEqual([]);
    expect(warnings).toHaveLength(MAX_QUERY_REPORTED_PROBLEMS + 1);
    expect(warnings.at(-1)).toEqual({
      code: 'more_warnings',
      path: [],
      omitted: MAX_QUERY_CONDITIONS * MAX_QUERY_IN_VALUES - MAX_QUERY_REPORTED_PROBLEMS,
      message: '1980 more warnings were left out.',
    });
    const suggested = warnings.flatMap((warning) =>
      warning.code === 'unknown_entity' ? [warning.suggestions.length] : [],
    );
    expect(suggested).toEqual([
      ...Array.from({ length: MAX_QUERY_SUGGESTED_NAMES }, () => 5),
      ...Array.from({ length: MAX_QUERY_REPORTED_PROBLEMS - MAX_QUERY_SUGGESTED_NAMES }, () => 0),
    ]);
    expect(JSON.stringify(result).length).toBeLessThan(8000);
  });

  it('warns once about a name that several conditions repeat', async () => {
    const result = await runQuery(
      {
        where: [
          ['core.issuer', 'in', ['Nobody Known', 'Nobody Known', 'nobody known']],
          ['core.recipient', '!=', 'Nobody Known'],
        ],
      },
      { db: database.db },
    );
    if (!result.ok) throw new Error('The query failed');
    expect(result.value.warnings.map(({ code, path }) => [code, path])).toEqual([
      ['unknown_entity', ['where', 0, 2]],
      ['unknown_entity', ['where', 0, 2]],
    ]);
    expect(
      result.value.warnings.flatMap((warning) =>
        warning.code === 'unknown_entity' ? [warning.name] : [],
      ),
    ).toEqual(['Nobody Known', 'nobody known']);
  });

  it('measures closeness against a fixed number of entities, the first that share a word start', async () => {
    const result = await runQuery(
      { where: [['core.issuer', '=', 'Synthetic Supplier 2999 X']], include_private: true },
      { db: database.db },
    );
    if (!result.ok) throw new Error('The query failed');
    const [warning] = result.value.warnings;
    const suggestions = warning?.code === 'unknown_entity' ? warning.suggestions : [];
    expect(suggestions).toHaveLength(5);
    expect(suggestions).not.toContain('Synthetic Supplier 2999');
    expect(suggestions).toContain('Synthetic Supplier 29');
  });

  it('still resolves a name and an alias among them', async () => {
    for (const name of ['synthetic supplier 0', 'Synthetic Provider 0 Ltd', firstId]) {
      expect(
        await runQuery({ where: [['core.issuer', '=', name]] }, { db: database.db }),
      ).toMatchObject({
        ok: true,
        value: { rows: [{ title: 'from the first supplier' }], warnings: [] },
      });
    }
  });

  // The limit is lowered to the number of entities there are instead of inserting ten
  // thousand: the comparison is the same line, with the limit as its only operand.
  it('compares a name with exactly as many entities as the limit, and not with one more', async () => {
    const byName = { where: [['core.issuer', '=', 'Synthetic Supplier 0']] };
    expect(await runQuery(byName, { db: database.db, maxEntities: FEW_THOUSAND })).toMatchObject({
      ok: true,
      value: { rows: [{ title: 'from the first supplier' }] },
    });
    expect(await runQuery(byName, { db: database.db, maxEntities: FEW_THOUSAND - 1 })).toEqual({
      ok: false,
      error: [
        {
          code: 'too_many_entities',
          path: ['where', 0, 2],
          message:
            'A name is compared with at most 2999 entities and more exist: give the id of the entity instead of its name.',
        },
      ],
    });
  });

  describe('past the number of entities a query reads', () => {
    beforeAll(async () => {
      await addSuppliers(FEW_THOUSAND, MAX_QUERY_ENTITIES + 1);
    });

    it('refuses to compare a name, and says to use an id', async () => {
      expect(
        await runQuery(
          {
            where: [
              ['title', 'exists', true],
              ['core.issuer', '=', 'Synthetic Supplier 0'],
            ],
          },
          { db: database.db },
        ),
      ).toEqual({
        ok: false,
        error: [
          {
            code: 'too_many_entities',
            path: ['where', 1, 2],
            message:
              'A name is compared with at most 10000 entities and more exist: give the id of the entity instead of its name.',
          },
        ],
      });
    });

    it('still compares an entity by its id, without reading the others', async () => {
      expect(
        await runQuery({ where: [['core.issuer', 'in', [firstId]]] }, { db: database.db }),
      ).toMatchObject({
        ok: true,
        value: { rows: [{ title: 'from the first supplier' }], warnings: [] },
      });
    });
  });
});

const WIDE_ENTITIES = 300;
const ALIASES_OF_EACH = 30;
const FILLER = 'y'.repeat(180);

const wideAlias = (entity: number, alias: number): string =>
  `E${String(entity)} A${String(alias)} ${FILLER}`;

describe('entity conditions against entities that hold many long names', () => {
  let database: TestDatabase;

  const issuedBy = async (name: string, includePrivate = true) => {
    const result = await runQuery(
      { where: [['core.issuer', '=', name]], include_private: includePrivate },
      { db: database.db },
    );
    if (!result.ok || !('rows' in result.value)) throw new Error(JSON.stringify(result));
    const [warning] = result.value.warnings;
    return {
      titles: result.value.rows.map(({ title }) => title),
      suggestions: warning?.code === 'unknown_entity' ? warning.suggestions : undefined,
    };
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    const wide = await db
      .insert(entities)
      .values(
        Array.from({ length: WIDE_ENTITIES }, (_, entity) => ({
          kind: 'org' as const,
          canonicalName: `Wide Holder ${String(entity)}`,
          aliases: Array.from({ length: ALIASES_OF_EACH }, (_, alias) => wideAlias(entity, alias)),
        })),
      )
      .returning({ id: entities.id });
    await db.insert(entities).values({
      kind: 'org',
      canonicalName: 'Short Holder',
      aliases: ['Kappa One', 'Lambda Two', 'Mu Three', 'Nu Four'],
    });
    await insertSyntheticDocument(db, {
      title: 'from the seventh wide holder',
      provenance: { issuer: { entity_id: wide[7]?.id } },
    });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('stays quick for unknown names close to every one of them', async () => {
    const started = performance.now();
    const result = await runQuery(
      {
        where: [
          [
            'core.issuer',
            'in',
            Array.from({ length: MAX_QUERY_SUGGESTED_NAMES }, (_, index) =>
              wideAlias(index, 0).replace(' A0 ', ' A0x '),
            ),
          ],
        ],
        include_private: true,
      },
      { db: database.db },
    );
    // Generous on purpose: the work is some tens of milliseconds, and was seconds.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result).toMatchObject({ ok: true, value: { warnings: { length: 5 } } });
  });

  it('takes the canonical name and the first fifteen aliases of an entity', async () => {
    expect(MAX_QUERY_ENTITY_NAMES).toBe(16);
    expect((await issuedBy(wideAlias(7, 14))).titles).toEqual(['from the seventh wide holder']);
    expect((await issuedBy(wideAlias(7, 15))).titles).toEqual([]);
    expect((await issuedBy('wide holder 7')).titles).toEqual(['from the seventh wide holder']);
  });

  it('compares the first eighty characters of a name', async () => {
    expect(MAX_QUERY_ENTITY_NAME_LENGTH).toBe(80);
    const start = wideAlias(7, 3).slice(0, MAX_QUERY_ENTITY_NAME_LENGTH);
    expect((await issuedBy(`${start} and another end`)).titles).toEqual([
      'from the seventh wide holder',
    ]);
    expect((await issuedBy(`${start.slice(0, -1)}z`)).titles).toEqual([]);
  });

  it('measures closeness against the first four names of an entity', async () => {
    expect(MAX_QUERY_SUGGESTION_NAMES).toBe(4);
    expect((await issuedBy('Mu Threee')).suggestions).toEqual(['Short Holder']);
    expect((await issuedBy('Nu Fourr')).suggestions).toEqual([]);
    expect((await issuedBy('Nu Four')).suggestions).toBeUndefined();
  });
});
