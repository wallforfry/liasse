import { MAX_TYPE_DESCRIPTION_LENGTH } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docTypes, entities, typeChanges } from '../db/schema/registry.ts';
import type { Embedder } from '../models/ports.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { RegistryContext } from './context.ts';
import { createType, type CreateTypeInput } from './create-type.ts';
import { FIELD_ANNOTATION } from './stored-schema.ts';

const ENERGY_BILL_FIELDS = {
  energy: { type: 'enum', values: ['electricity', 'gas', 'dual'] },
  meter_id: { type: 'identifier', format: 'PDL' },
  consumption_kwh: { type: 'number' },
  supply_address: { type: 'text' },
};

const draft = (slug: string, overrides: Partial<CreateTypeInput> = {}): CreateTypeInput => ({
  slug,
  description: `Synthetic description of ${slug}`,
  fields: {},
  ...overrides,
});

const countingEmbedder = (): Embedder & { readonly calls: () => number } => {
  const embedder = createFakeEmbedder();
  let calls = 0;
  return {
    ...embedder,
    embed: (texts, kind) => {
      calls += 1;
      return embedder.embed(texts, kind);
    },
    calls: () => calls,
  };
};

describe('createType', () => {
  let database: TestDatabase;

  const context = (overrides: Partial<RegistryContext> = {}): RegistryContext => ({
    db: database.db,
    embedder: createFakeEmbedder(),
    schemaLanguage: 'en',
    now: () => new Date('2026-01-15T10:00:00.000Z'),
    ...overrides,
  });

  const errorOf = async (input: CreateTypeInput, overrides: Partial<RegistryContext> = {}) => {
    const result = await createType(input, context(overrides));
    return result.ok ? undefined : result.error;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.db.insert(entities).values([
      { kind: 'org', canonicalName: 'EDF', aliases: ['Électricité de Synthèse SA'] },
      { kind: 'person', canonicalName: 'Jane Doe' },
    ]);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('creates a provisional type at version 1 with its fields', async () => {
    const result = await createType(
      draft('energy_bill', {
        description: '  Bill from an electricity or gas supplier for a home  ',
        fields: ENERGY_BILL_FIELDS,
      }),
      context(),
    );
    expect(result.ok ? result.value.id : '').toMatch(/^typ_/);
    expect(result).toMatchObject({
      ok: true,
      value: {
        slug: 'energy_bill',
        description: 'Bill from an electricity or gas supplier for a home',
        fields: ENERGY_BILL_FIELDS,
        version: 1,
        status: 'provisional',
        parentSlug: null,
        aliases: [],
      },
    });
  });

  it('stores the restricted JSON Schema, the embedding of the description and the clock', async () => {
    const now = new Date('2026-01-15T12:34:56.000Z');
    await createType(draft('water_bill', { fields: { volume: { type: 'number' } } }), {
      ...context(),
      now: () => now,
    });
    const [row] = await database.db.select().from(docTypes).where(eq(docTypes.slug, 'water_bill'));
    const [embedding] = await createFakeEmbedder().embed(
      ['Synthetic description of water_bill'],
      'passage',
    );
    expect(row).toMatchObject({
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { volume: { type: 'number', [FIELD_ANNOTATION]: { type: 'number' } } },
      },
      createdAt: now,
      updatedAt: now,
    });
    expect(row?.embedding).toHaveLength(embedding?.length ?? 0);
    row?.embedding?.forEach((value, index) => {
      expect(value).toBeCloseTo(embedding?.[index] ?? Number.NaN, 5);
    });
  });

  it('writes nothing but the type: no type_changes row', async () => {
    await createType(draft('rent_receipt'), context());
    expect(await database.db.$count(typeChanges)).toBe(0);
  });

  it.each([
    ['EnergyBill', ['snake_case']],
    ['bill_2026', ['digit']],
    ['october_bill', ['month']],
    ['edf_october', ['month', 'entity']],
    ['edf_bill', ['entity']],
    ['electricite_de_synthese_bill', ['entity']],
    ['jane_doe_payslip', ['entity', 'entity']],
    ['doe_agreement', ['entity']],
  ])('rejects the slug %s', async (slug, rules) => {
    const error = await errorOf(draft(slug));
    expect(error).toMatchObject({ code: 'invalid_slug', slug });
    expect(error?.code === 'invalid_slug' ? error.violations.map(({ rule }) => rule) : []).toEqual(
      rules,
    );
    expect(await database.db.$count(docTypes, eq(docTypes.slug, slug))).toBe(0);
  });

  it('refuses the months of the configured schema language, and still the English ones', async () => {
    const french = { schemaLanguage: 'fr' } as const;
    expect(await errorOf(draft('bill_octobre'), french)).toMatchObject({
      code: 'invalid_slug',
      violations: [{ rule: 'month' }],
    });
    expect(await errorOf(draft('bill_october'), french)).toMatchObject({ code: 'invalid_slug' });
    expect((await createType(draft('gas_bill'), context(french))).ok).toBe(true);
    expect((await createType(draft('bill_octobre'), context())).ok).toBe(true);
  });

  it('accepts one word of an organisation named with several', async () => {
    expect((await createType(draft('synthese_report'), context())).ok).toBe(true);
  });

  it('lets an entity word through once a type slug uses it', async () => {
    await database.db.insert(entities).values({ kind: 'org', canonicalName: 'Warranty' });
    expect(await errorOf(draft('warranty'))).toMatchObject({ code: 'invalid_slug' });
    await database.db.insert(docTypes).values({ slug: 'extended_warranty', description: 'x' });
    expect((await createType(draft('warranty'), context())).ok).toBe(true);
  });

  it.each(['', '   ', 'x'.repeat(MAX_TYPE_DESCRIPTION_LENGTH + 1)])(
    'rejects the description %j',
    async (description) => {
      expect(await errorOf(draft('bad_description', { description }))).toMatchObject({
        code: 'invalid_description',
      });
    },
  );

  it('accepts a description of the maximum length', async () => {
    const description = 'x'.repeat(MAX_TYPE_DESCRIPTION_LENGTH);
    expect((await createType(draft('long_description', { description }), context())).ok).toBe(true);
  });

  it('rejects invalid fields with one issue per broken rule', async () => {
    const error = await errorOf(
      draft('bad_fields', {
        fields: { amount: { type: 'money' }, notes: { type: 'object' } },
      }),
    );
    expect(error).toMatchObject({
      code: 'invalid_fields',
      issues: [
        { field: 'amount', rule: 'reserved' },
        { field: 'notes', rule: 'invalid_definition' },
      ],
    });
  });

  it('rejects a slug that is already a slug or an alias of any type', async () => {
    await createType(draft('payslip'), context());
    await database.db
      .update(docTypes)
      .set({ aliases: ['salary_statement'] })
      .where(eq(docTypes.slug, 'payslip'));
    expect(await errorOf(draft('payslip'))).toMatchObject({
      code: 'name_taken',
      name: 'payslip',
      heldBy: 'payslip',
    });
    expect(await errorOf(draft('salary_statement'))).toMatchObject({
      code: 'name_taken',
      name: 'salary_statement',
      heldBy: 'payslip',
    });
  });

  describe('hierarchy', () => {
    it('attaches a type to an existing parent', async () => {
      await createType(draft('contract'), context());
      const child = await createType(
        draft('employment_contract', { parentSlug: 'contract' }),
        context(),
      );
      expect(child).toMatchObject({ ok: true, value: { parentSlug: 'contract' } });
    });

    it('stores the slug of the parent when given one of its aliases', async () => {
      await createType(draft('notice'), context());
      await database.db
        .update(docTypes)
        .set({ aliases: ['official_notice'] })
        .where(eq(docTypes.slug, 'notice'));
      const child = await createType(
        draft('tax_notice', { parentSlug: 'official_notice' }),
        context(),
      );
      expect(child).toMatchObject({ ok: true, value: { parentSlug: 'notice' } });
    });

    it('rejects a parent that does not exist, including the type itself', async () => {
      expect(await errorOf(draft('orphan', { parentSlug: 'nowhere' }))).toMatchObject({
        code: 'parent_not_found',
      });
      expect(await errorOf(draft('own_parent', { parentSlug: 'own_parent' }))).toMatchObject({
        code: 'parent_not_found',
      });
    });

    it('rejects a third level', async () => {
      await createType(draft('statement'), context());
      await createType(draft('bank_statement', { parentSlug: 'statement' }), context());
      expect(
        await errorOf(draft('savings_statement', { parentSlug: 'bank_statement' })),
      ).toMatchObject({ code: 'hierarchy_too_deep' });
      expect(await database.db.$count(docTypes, eq(docTypes.slug, 'savings_statement'))).toBe(0);
    });
  });

  describe('on one day', () => {
    // An import on an empty registry creates a type for each kind of document it meets.
    it('creates every type asked for, with no daily bound', async () => {
      const sameDay = { now: () => new Date('2030-03-10T09:00:00.000Z') };
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          createType(draft(`bootstrap_${'abcdefghijkl'.charAt(index)}`), context(sameDay)),
        ),
      );
      expect(results.filter(({ ok }) => ok)).toHaveLength(12);
    });

    it('stamps the type when it is written, after a slow embedder', async () => {
      let clock = new Date('2040-06-01T23:59:59.900Z');
      const fake = createFakeEmbedder();
      const slow: Embedder = {
        ...fake,
        embed: (texts, kind) => {
          clock = new Date('2040-06-02T00:00:01.000Z');
          return fake.embed(texts, kind);
        },
      };
      expect(
        (await createType(draft('slow_embedder'), context({ now: () => clock, embedder: slow })))
          .ok,
      ).toBe(true);
      const [row] = await database.db
        .select({ createdAt: docTypes.createdAt })
        .from(docTypes)
        .where(eq(docTypes.slug, 'slow_embedder'));
      expect(row?.createdAt).toEqual(new Date('2040-06-02T00:00:01.000Z'));
    });

    it('does not call the embedder for a creation that is refused', async () => {
      const embedder = countingEmbedder();
      await createType(draft('already_there'), context());
      await createType(draft('already_there'), context({ embedder }));
      await createType(draft('Refused By Naming'), context({ embedder }));
      expect(embedder.calls()).toBe(0);
    });
  });

  it('never lets two concurrent creations take the same slug', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createType(draft('contested_slug'), context())),
    );
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.flatMap((result) => (result.ok ? [] : [result.error.code]))).toEqual(
      Array.from({ length: 5 }, () => 'name_taken'),
    );
  });
});
