import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { RegistryContext } from './context.ts';
import { createType } from './create-type.ts';
import { addAlias, markMerged, setStatus } from './lifecycle.ts';
import { closestTypes, listTypes, resolveType } from './read-types.ts';
import { InvalidTypeSchemaError } from './stored-schema.ts';
import type { RegisteredType } from './type-store.ts';

const DESCRIPTIONS = {
  energy_bill: 'Bill from an electricity or gas supplier for a home',
  phone_bill: 'Bill from a mobile phone or internet operator',
  payslip: 'Monthly payslip issued by an employer',
  lease: 'Lease agreement for a rented home',
} as const;

describe('reading the registry', () => {
  let database: TestDatabase;
  let context: RegistryContext;
  const types = new Map<string, RegisteredType>();

  const typeOf = (slug: string): RegisteredType => {
    const type = types.get(slug);
    if (type === undefined) throw new Error(`The fixture type ${slug} is missing`);
    return type;
  };

  const addDocument = (slug: string, title: string | null, ingestedAt: string, isPrivate = false) =>
    insertSyntheticDocument(database.db, {
      typeId: typeOf(slug).id,
      title,
      ingestedAt: new Date(ingestedAt),
      private: isPrivate,
    });

  const embed = async (text: string) => {
    const [embedding] = await context.embedder.embed([text], 'query');
    if (embedding === undefined) throw new Error('The fake embedder returned nothing');
    return embedding;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    context = {
      db: database.db,
      embedder: createFakeEmbedder(),
      maxNewTypesPerDay: 1000,
      schemaLanguage: 'en',
    };
    for (const [slug, description] of Object.entries(DESCRIPTIONS)) {
      const created = await createType(
        { slug, description, fields: { reference_code: { type: 'identifier' } } },
        context,
      );
      if (!created.ok) throw new Error(created.error.message);
      types.set(slug, created.value);
    }
    await addAlias(typeOf('energy_bill').id, 'electricity_bill', context);
    await setStatus(typeOf('payslip').id, 'stable', context);
    await markMerged(typeOf('phone_bill').id, typeOf('energy_bill').id, context);
    await addDocument('energy_bill', 'Energy bill of September', '2026-10-01T00:00:00Z');
    await addDocument('energy_bill', 'Energy bill of October', '2026-11-01T00:00:00Z');
    await addDocument('energy_bill', 'Energy bill of November', '2026-12-01T00:00:00Z');
    await addDocument('energy_bill', 'Energy bill of December', '2027-01-01T00:00:00Z');
    await addDocument('energy_bill', 'Private energy bill', '2027-02-01T00:00:00Z', true);
    await addDocument('energy_bill', null, '2027-03-01T00:00:00Z');
    await addDocument('payslip', 'Payslip of October', '2026-11-01T00:00:00Z');
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('resolveType', () => {
    it('resolves a slug and an alias to the same type', async () => {
      const bySlug = await resolveType('energy_bill', context);
      expect(bySlug).toMatchObject({ slug: 'energy_bill', status: 'provisional' });
      expect(await resolveType('electricity_bill', context)).toEqual(bySlug);
    });

    it('follows a merged type to its target', async () => {
      expect(await resolveType('phone_bill', context)).toMatchObject({ slug: 'energy_bill' });
    });

    it('answers nothing for an unknown name', async () => {
      expect(await resolveType('unknown_type', context)).toBeUndefined();
    });
  });

  describe('listTypes', () => {
    it('lists every type that is not merged, with its fields and its document count', async () => {
      const listed = await listTypes({}, context);
      // One energy bill is private: it is counted only when asked for.
      expect(listed.map(({ slug, docCount }) => [slug, docCount])).toEqual([
        ['energy_bill', 5],
        ['lease', 0],
        ['payslip', 1],
      ]);
      const withPrivate = await listTypes({ includePrivate: true }, context);
      expect(withPrivate.map(({ slug, docCount }) => [slug, docCount])).toEqual([
        ['energy_bill', 6],
        ['lease', 0],
        ['payslip', 1],
      ]);
      expect(listed[0]).toMatchObject({
        description: DESCRIPTIONS.energy_bill,
        fields: { reference_code: { type: 'identifier' } },
        version: 1,
        status: 'provisional',
        parentSlug: null,
        aliases: ['electricity_bill', 'phone_bill'],
      });
      expect(listed[0]).not.toHaveProperty('examples');
    });

    it('filters by status, merged included', async () => {
      const slugs = async (status: 'provisional' | 'stable' | 'merged') =>
        (await listTypes({ status }, context)).map(({ slug }) => slug);
      expect(await slugs('stable')).toEqual(['payslip']);
      expect(await slugs('provisional')).toEqual(['energy_bill', 'lease']);
      expect(await slugs('merged')).toEqual(['phone_bill']);
    });

    it('counts documents on read, so the count follows them', async () => {
      const count = async () =>
        (await listTypes({ status: 'stable' }, context)).map(({ docCount }) => docCount);
      const moved = await addDocument('lease', 'Lease of the flat', '2026-06-01T00:00:00Z');
      await database.db
        .update(documents)
        .set({ typeId: typeOf('payslip').id })
        .where(eq(documents.id, moved.id));
      expect(await count()).toEqual([2]);
      await database.db.delete(documents).where(eq(documents.id, moved.id));
      expect(await count()).toEqual([1]);
    });

    it('leaves deleted documents out of the count and of the examples', async () => {
      // `deleteDocument` clears the type and the title of a tombstone; the count must
      // not rely on that, so this row keeps both.
      await insertSyntheticDocument(database.db, {
        typeId: typeOf('lease').id,
        title: 'Deleted lease',
        status: 'deleted',
      });
      const listed = await listTypes({ includeExamples: true }, context);
      const lease = listed.find(({ slug }) => slug === 'lease');
      expect(lease).toMatchObject({ docCount: 0, examples: [] });
    });

    it('gives the most recent titles as examples, without private or untitled documents', async () => {
      const listed = await listTypes({ includeExamples: true }, context);
      expect(listed.map(({ slug, examples }) => [slug, examples])).toEqual([
        [
          'energy_bill',
          ['Energy bill of December', 'Energy bill of November', 'Energy bill of October'],
        ],
        ['lease', []],
        ['payslip', ['Payslip of October']],
      ]);
    });
  });

  describe('closestTypes', () => {
    it('orders the types by similarity to the embedding, with one example title', async () => {
      const closest = await closestTypes(await embed(DESCRIPTIONS.payslip), context);
      expect(closest.map(({ type }) => type.slug)).toEqual([
        'payslip',
        ...closest.slice(1).map(({ type }) => type.slug),
      ]);
      expect(closest[0]).toMatchObject({
        type: { slug: 'payslip', description: DESCRIPTIONS.payslip },
        exampleTitle: 'Payslip of October',
      });
      expect(closest[0]?.similarity).toBeCloseTo(1, 5);
      expect(closest.map(({ similarity }) => similarity)).toEqual(
        closest.map(({ similarity }) => similarity).toSorted((a, b) => b - a),
      );
    });

    it('leaves merged types out and gives no title to a type without a public one', async () => {
      const closest = await closestTypes(await embed(DESCRIPTIONS.phone_bill), context);
      expect(closest.map(({ type }) => type.slug).toSorted()).toEqual([
        'energy_bill',
        'lease',
        'payslip',
      ]);
      expect(closest.find(({ type }) => type.slug === 'lease')?.exampleTitle).toBeNull();
      expect(closest.find(({ type }) => type.slug === 'energy_bill')?.exampleTitle).toBe(
        'Energy bill of December',
      );
    });

    it('returns at most k types, eight by default', async () => {
      const embedding = await embed(DESCRIPTIONS.lease);
      expect(await closestTypes(embedding, context, 2)).toHaveLength(2);
      expect((await closestTypes(embedding, context, 1))[0]?.type.slug).toBe('lease');
      const crowded = await createTestDatabase();
      try {
        const crowdedContext = { ...context, db: crowded.db };
        for (const letter of 'abcdefghij') {
          await createType(
            { slug: `type_${letter}`, description: `Synthetic type ${letter}`, fields: {} },
            crowdedContext,
          );
        }
        expect(await closestTypes(embedding, crowdedContext)).toHaveLength(8);
      } finally {
        await crowded.dispose();
      }
    });
  });

  it('refuses to read a type whose schema was written around the registry', async () => {
    const corrupted = await createTestDatabase();
    try {
      await corrupted.db.insert(docTypes).values({
        slug: 'corrupted',
        description: 'A row written without the registry',
        schema: { fields: { notes: { type: 'object' } } },
      });
      const read = { db: corrupted.db };
      await expect(listTypes({}, read)).rejects.toThrow(InvalidTypeSchemaError);
      await expect(resolveType('corrupted', read)).rejects.toThrow(InvalidTypeSchemaError);
    } finally {
      await corrupted.dispose();
    }
  });
});
