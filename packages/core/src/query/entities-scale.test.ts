import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import {
  DEFAULT_QUERY_TIMEOUT_MILLISECONDS,
  MAX_QUERY_CONDITIONS,
  MAX_QUERY_ENTITIES,
  MAX_QUERY_IN_VALUES,
  MAX_QUERY_REPORTED_PROBLEMS,
  MAX_QUERY_SUGGESTED_NAMES,
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
