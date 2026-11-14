import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import { entityIdProvenancePath, PROVENANCE_ENTITY_ID_KEY } from '../domain/provenance.ts';
import { MAX_QUERY_SUGGESTED_ENTITIES } from '../domain/limits.ts';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { runQuery } from './run.ts';

describe('entity conditions', () => {
  let database: TestDatabase;
  const ids: Record<string, string> = {};

  const rowsOf = async (query: unknown) => {
    const result = await runQuery(query, { db: database.db });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    if (!('rows' in result.value)) throw new Error('The query answered groups');
    return {
      titles: result.value.rows.map(({ title }) => title),
      warnings: result.value.warnings,
    };
  };

  const issuedBy = (operator: string, value: unknown) =>
    rowsOf({ where: [['core.issuer', operator, value]] });

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    const entity = async (key: string, canonicalName: string, aliases: readonly string[] = []) => {
      const [row] = await db
        .insert(entities)
        .values({ kind: 'org', canonicalName, aliases })
        .returning();
      if (row === undefined) throw new Error('No entity inserted');
      ids[key] = row.id;
      return row.id;
    };
    const edf = await entity('edf', 'EDF', ['Électricité de France', 'Synthetic Power']);
    const engie = await entity('engie', 'Engie');
    const acme = await entity('acme', 'Acme');
    const acmeLimited = await entity('acmeLimited', 'ACME Ltd');
    const lease = await createType(
      {
        slug: 'lease',
        description: 'A synthetic lease',
        fields: {
          landlord: { type: 'entity' },
          parties: { type: 'list', items: { type: 'entity' } },
        },
      },
      { db, embedder: createFakeEmbedder(), maxNewTypesPerDay: 10, schemaLanguage: 'en' },
    );
    if (!lease.ok) throw new Error(lease.error.message);
    // The stored name never equals a name of the entity: only the provenance links them.
    const issued = (title: string, entityId?: string) =>
      insertSyntheticDocument(db, {
        title,
        core: { issuer: `Name written on ${title}` },
        provenance: entityId === undefined ? {} : { issuer: { entity_id: entityId } },
      });
    await issued('from edf', edf);
    await issued('from engie', engie);
    await issued('from acme', acme);
    await issued('from acme limited', acmeLimited);
    await issued('unresolved');
    await insertSyntheticDocument(db, {
      title: 'lease',
      typeId: lease.value.id,
      fields: { landlord: 'The landlord', parties: ['EDF', 'Engie SA'] },
      provenance: { landlord: { entity_id: engie } },
    });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('keeps the id of an entity under the name of its field in the provenance', () => {
    expect(PROVENANCE_ENTITY_ID_KEY).toBe('entity_id');
    expect(entityIdProvenancePath('issuer')).toEqual(['issuer', 'entity_id']);
  });

  it.each([
    ['its canonical name', 'EDF'],
    ['another case', 'edf'],
    ['a legal form and dots', 'E.D.F. S.A.'],
    ['an alias', 'Électricité de France'],
    ['an alias without its accents', 'electricite de france'],
    ['another alias', 'Synthetic Power Inc'],
  ])('finds the documents resolved to an entity by %s', async (_, name) => {
    expect(await issuedBy('=', name)).toEqual({ titles: ['from edf'], warnings: [] });
  });

  it('finds them by the id of the entity', async () => {
    expect(await issuedBy('=', ids.engie)).toEqual({ titles: ['from engie'], warnings: [] });
  });

  it('never compares with the name a document stores', async () => {
    expect((await issuedBy('=', 'Name written on from edf')).titles).toEqual([]);
    expect((await issuedBy('exists', true)).titles).toEqual([
      'from edf',
      'from engie',
      'from acme',
      'from acme limited',
      'unresolved',
    ]);
  });

  it('compares with every entity that bears the name', async () => {
    expect((await issuedBy('=', 'acme')).titles).toEqual(['from acme', 'from acme limited']);
    expect((await issuedBy('!=', 'acme')).titles).toEqual([
      'from edf',
      'from engie',
      'unresolved',
      'lease',
    ]);
  });

  it('reads the entity of a type field under the bare name of the field', async () => {
    const landlord = (name: string) =>
      rowsOf({ type: 'lease', where: [['fields.landlord', '=', name]] });
    expect((await landlord('engie')).titles).toEqual(['lease']);
    expect((await landlord('EDF')).titles).toEqual([]);
  });

  it('answers no row and a warning with close names for an unknown name', async () => {
    expect(await issuedBy('=', 'Engy')).toEqual({
      titles: [],
      warnings: [
        {
          code: 'unknown_entity',
          path: ['where', 0, 2],
          message:
            'No entity has the name or the id "Engy", so it stands for no document. Close names: Engie.',
        },
      ],
    });
    expect((await issuedBy('=', 'Wholly Unrelated Company')).warnings).toMatchObject([
      {
        message:
          'No entity has the name or the id "Wholly Unrelated Company", so it stands for no document.',
      },
    ]);
  });

  it('keeps the entities it knows when another of the list is unknown', async () => {
    const mixed = await issuedBy('in', ['EDF', 'Nobody Known', ids.engie]);
    expect(mixed.titles).toEqual(['from edf', 'from engie']);
    expect(mixed.warnings).toMatchObject([{ code: 'unknown_entity', path: ['where', 0, 2] }]);
    const excluded = await issuedBy('!=', 'Nobody Known');
    expect(excluded.titles).toHaveLength(6);
    expect(excluded.warnings).toHaveLength(1);
  });

  it('looks for a name as it is stored in a list of entities', async () => {
    const parties = (name: string) =>
      rowsOf({ type: 'lease', where: [['fields.parties', 'contains', name]] });
    expect(await parties('Engie SA')).toEqual({ titles: ['lease'], warnings: [] });
    expect(await parties('EDF')).toEqual({ titles: ['lease'], warnings: [] });
    expect(await parties('engie')).toEqual({ titles: [], warnings: [] });
  });

  it('suggests a bounded number of close names, closest first', async () => {
    const names = Array.from(
      { length: MAX_QUERY_SUGGESTED_ENTITIES + 2 },
      (_, index) => `Vendor A${String(index + 1)}`,
    );
    await database.db.insert(entities).values(
      // Two characters away and first by id, then one character away, then too far.
      ['Vendor B9', ...names, 'Vendor A0 West'].map((canonicalName) => ({
        kind: 'org' as const,
        canonicalName,
      })),
    );
    const [warning] = (await issuedBy('=', 'Vendor A0')).warnings;
    expect(warning?.message).toBe(
      `No entity has the name or the id "Vendor A0", so it stands for no document. Close names: ${names.slice(0, MAX_QUERY_SUGGESTED_ENTITIES).join(', ')}.`,
    );
  });

  it('does not read the entities for a query that compares none', async () => {
    const { db } = database;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE entities IN ACCESS EXCLUSIVE MODE`);
      return runQuery(
        {
          type: 'lease',
          where: [
            ['core.issuer', 'exists', false],
            ['fields.parties', 'contains', 'EDF'],
          ],
        },
        { db, timeoutMilliseconds: 1000 },
      );
    });
    expect(result).toMatchObject({ ok: true, value: { rows: [{ title: 'lease' }] } });
  });
});
