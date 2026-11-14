import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { docTypes, typeChanges } from '../db/schema/registry.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { RegistryContext } from './context.ts';
import { createType } from './create-type.ts';
import { addAlias, markMerged, setStatus } from './lifecycle.ts';
import { resolveType } from './read-types.ts';
import type { RegisteredType } from './type-store.ts';

describe('type lifecycle', () => {
  let database: TestDatabase;
  let context: RegistryContext;

  const newType = async (slug: string, parentSlug?: string): Promise<RegisteredType> => {
    const created = await createType(
      { slug, description: `Synthetic ${slug}`, parentSlug, fields: { note: { type: 'text' } } },
      context,
    );
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  };

  const stored = async (slug: string) => {
    const [row] = await database.db
      .select({
        status: docTypes.status,
        aliases: docTypes.aliases,
        parentSlug: docTypes.parentSlug,
        version: docTypes.version,
      })
      .from(docTypes)
      .where(eq(docTypes.slug, slug));
    return row;
  };

  const codeOf = async (operation: Promise<{ ok: boolean; error?: { code: string } }>) =>
    (await operation).error?.code;

  beforeAll(async () => {
    database = await createTestDatabase();
    context = { db: database.db, embedder: createFakeEmbedder(), maxNewTypesPerDay: 1000 };
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('setStatus', () => {
    it('moves a type between provisional and stable without a new version', async () => {
      const type = await newType('status_change');
      expect(await setStatus(type.id, 'stable', context)).toEqual({
        ok: true,
        value: { ...type, status: 'stable' },
      });
      expect(await setStatus(type.id, 'provisional', context)).toEqual({ ok: true, value: type });
    });

    it('never sets merged directly', async () => {
      const type = await newType('status_merged');
      expect(await codeOf(setStatus(type.id, 'merged', context))).toBe('invalid_status');
      expect(await stored('status_merged')).toMatchObject({ status: 'provisional' });
    });

    it('rejects an unknown type and a merged type', async () => {
      const source = await newType('status_source');
      const target = await newType('status_target');
      await markMerged(source.id, target.id, context);
      expect(await codeOf(setStatus('typ_unknown', 'stable', context))).toBe('type_not_found');
      expect(await codeOf(setStatus(source.id, 'stable', context))).toBe('type_merged');
      expect(await stored('status_source')).toMatchObject({ status: 'merged' });
    });
  });

  describe('addAlias', () => {
    it('adds an alias that then resolves to the type', async () => {
      const type = await newType('alias_owner');
      expect(await addAlias(type.id, 'alias_first', context)).toMatchObject({
        ok: true,
        value: { aliases: ['alias_first'], version: 1 },
      });
      expect(await addAlias(type.id, 'alias_second', context)).toMatchObject({
        ok: true,
        value: { aliases: ['alias_first', 'alias_second'] },
      });
      expect(await resolveType('alias_second', context)).toMatchObject({ slug: 'alias_owner' });
    });

    it('accepts an alias the slug denylist would refuse', async () => {
      const type = await newType('legacy_owner');
      expect((await addAlias(type.id, 'bill_2025', context)).ok).toBe(true);
    });

    it('rejects an alias that is not snake_case', async () => {
      const type = await newType('alias_shape');
      expect(await addAlias(type.id, 'Not A Slug', context)).toMatchObject({
        ok: false,
        error: { code: 'invalid_alias', alias: 'Not A Slug', violations: [{ rule: 'snake_case' }] },
      });
    });

    it('rejects a name already held as a slug or an alias, its own included', async () => {
      const owner = await newType('alias_holder');
      const other = await newType('alias_other');
      await addAlias(owner.id, 'alias_held', context);
      expect(await addAlias(other.id, 'alias_holder', context)).toMatchObject({
        ok: false,
        error: { code: 'name_taken', name: 'alias_holder', heldBy: 'alias_holder' },
      });
      expect(await addAlias(other.id, 'alias_held', context)).toMatchObject({
        ok: false,
        error: { code: 'name_taken', name: 'alias_held', heldBy: 'alias_holder' },
      });
      expect(await codeOf(addAlias(owner.id, 'alias_held', context))).toBe('name_taken');
      expect(await codeOf(addAlias(owner.id, 'alias_holder', context))).toBe('name_taken');
      expect(await stored('alias_other')).toMatchObject({ aliases: [] });
    });

    it('never lets two concurrent calls give the same alias to two types', async () => {
      const candidates = await Promise.all(
        ['race_a', 'race_b', 'race_c', 'race_d'].map((slug) => newType(slug)),
      );
      const results = await Promise.all(
        candidates.map(({ id }) => addAlias(id, 'contested_alias', context)),
      );
      expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    });

    it('rejects an unknown type and a merged type', async () => {
      const source = await newType('alias_source');
      const target = await newType('alias_target');
      await markMerged(source.id, target.id, context);
      expect(await codeOf(addAlias('typ_unknown', 'some_alias', context))).toBe('type_not_found');
      expect(await codeOf(addAlias(source.id, 'some_alias', context))).toBe('type_merged');
    });
  });

  describe('markMerged', () => {
    it('marks the source merged and hands its slug and aliases to the target', async () => {
      const source = await newType('electricity_bill');
      const target = await newType('energy_bill');
      await addAlias(source.id, 'power_bill', context);
      await addAlias(target.id, 'utility_bill', context);
      expect(await markMerged(source.id, target.id, context)).toEqual({
        ok: true,
        value: { ...target, aliases: ['utility_bill', 'electricity_bill', 'power_bill'] },
      });
      expect(await stored('electricity_bill')).toMatchObject({
        status: 'merged',
        aliases: [],
        version: 1,
      });
      for (const name of ['electricity_bill', 'power_bill', 'utility_bill', 'energy_bill']) {
        expect(await resolveType(name, context)).toMatchObject({ id: target.id });
      }
    });

    it('still resolves the first slug after a chain of merges', async () => {
      const first = await newType('chain_first');
      const second = await newType('chain_second');
      const third = await newType('chain_third');
      await markMerged(first.id, second.id, context);
      await markMerged(second.id, third.id, context);
      expect(await resolveType('chain_first', context)).toMatchObject({
        id: third.id,
        aliases: ['chain_second', 'chain_first'],
      });
    });

    it('keeps the names of a merged type out of reach of new types and aliases', async () => {
      const source = await newType('retired_name');
      const target = await newType('surviving_name');
      await markMerged(source.id, target.id, context);
      expect(
        await codeOf(createType({ slug: 'retired_name', description: 'x', fields: {} }, context)),
      ).toBe('name_taken');
      expect(await codeOf(addAlias(target.id, 'retired_name', context))).toBe('name_taken');
    });

    it('leaves documents, type_changes and jobs alone', async () => {
      const source = await newType('untouched_source');
      const target = await newType('untouched_target');
      const document = await insertSyntheticDocument(database.db, { typeId: source.id });
      await markMerged(source.id, target.id, context);
      const [after] = await database.db
        .select()
        .from(documents)
        .where(eq(documents.id, document.id));
      expect(after).toEqual(document);
      expect(await database.db.$count(typeChanges)).toBe(0);
      expect(await database.db.$count(jobs)).toBe(0);
    });

    it('rejects a merge into itself, an unknown type and a type already merged', async () => {
      const source = await newType('merge_source');
      const target = await newType('merge_target');
      const other = await newType('merge_other');
      expect(await codeOf(markMerged(source.id, source.id, context))).toBe('invalid_merge');
      expect(await codeOf(markMerged('typ_unknown', target.id, context))).toBe('type_not_found');
      expect(await codeOf(markMerged(source.id, 'typ_unknown', context))).toBe('type_not_found');
      await markMerged(source.id, target.id, context);
      expect(await codeOf(markMerged(source.id, other.id, context))).toBe('type_merged');
      expect(await codeOf(markMerged(other.id, source.id, context))).toBe('type_merged');
      expect(await stored('merge_other')).toMatchObject({ status: 'provisional', aliases: [] });
    });

    describe('hierarchy', () => {
      it('moves the children of the source under the target', async () => {
        const source = await newType('old_parent');
        const target = await newType('new_parent');
        await newType('child_one', 'old_parent');
        await newType('child_two', 'old_parent');
        expect((await markMerged(source.id, target.id, context)).ok).toBe(true);
        expect(await stored('child_one')).toMatchObject({ parentSlug: 'new_parent' });
        expect(await stored('child_two')).toMatchObject({ parentSlug: 'new_parent' });
      });

      it('puts the target at the top when it was a child of the source', async () => {
        const source = await newType('generic_parent');
        const target = await newType('promoted_child', 'generic_parent');
        await newType('sibling_child', 'generic_parent');
        expect(await markMerged(source.id, target.id, context)).toMatchObject({
          ok: true,
          value: { parentSlug: null },
        });
        expect(await stored('sibling_child')).toMatchObject({ parentSlug: 'promoted_child' });
      });

      it('keeps the parent of the target when the source has no child', async () => {
        await newType('kept_parent');
        const source = await newType('leaf_source');
        const target = await newType('leaf_target', 'kept_parent');
        expect(await markMerged(source.id, target.id, context)).toMatchObject({
          ok: true,
          value: { parentSlug: 'kept_parent' },
        });
      });

      it('does not take a merged child for a child', async () => {
        const alpha = await newType('alpha_parent');
        const beta = await newType('beta_child', 'alpha_parent');
        await newType('papa_parent');
        const charlie = await newType('charlie_child', 'papa_parent');
        expect((await markMerged(beta.id, alpha.id, context)).ok).toBe(true);
        expect(await markMerged(alpha.id, charlie.id, context)).toMatchObject({
          ok: true,
          value: { parentSlug: 'papa_parent' },
        });
        expect(await stored('beta_child')).toMatchObject({
          status: 'merged',
          parentSlug: 'alpha_parent',
        });
      });

      it('rejects a merge that would make a third level, and writes nothing', async () => {
        await newType('top_level');
        const source = await newType('parent_source');
        const target = await newType('child_target', 'top_level');
        await newType('grandchild', 'parent_source');
        expect(await codeOf(markMerged(source.id, target.id, context))).toBe('hierarchy_too_deep');
        expect(await stored('parent_source')).toMatchObject({ status: 'provisional' });
        expect(await stored('grandchild')).toMatchObject({ parentSlug: 'parent_source' });
        expect(await stored('child_target')).toMatchObject({ aliases: [] });
      });
    });
  });
});
