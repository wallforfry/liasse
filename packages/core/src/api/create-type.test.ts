import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';
import { docTypes } from '../db/schema/registry.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { ApiContext } from './context.ts';
import { createType } from './create-type.ts';
import { describeTypes } from './describe-types.ts';
import { ApiError } from './errors.ts';

const refusalOf = async (work: Promise<unknown>): Promise<ApiError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
};

describe('createType', () => {
  let database: TestDatabase;
  let context: Pick<ApiContext, 'db' | 'embedder' | 'schemaLanguage'>;

  beforeAll(async () => {
    database = await createTestDatabase();
    context = { db: database.db, embedder: createFakeEmbedder(), schemaLanguage: 'en' };
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('creates a provisional type that the registry then lists', async () => {
    const created = await createType(context, {
      slug: 'energy_bill',
      description: '  Bill from an electricity or gas supplier  ',
      fields: {
        energy: { type: 'enum', values: ['electricity', 'gas'] },
        meter_id: { type: 'identifier', format: 'PDL' },
        readings: { type: 'list', items: { type: 'number' } },
      },
    });
    expect(created).toEqual({
      slug: 'energy_bill',
      description: 'Bill from an electricity or gas supplier',
      parent_slug: null,
      version: 1,
      status: 'provisional',
      aliases: [],
      fields: {
        energy: { type: 'enum', values: ['electricity', 'gas'] },
        meter_id: { type: 'identifier', format: 'PDL' },
        readings: { type: 'list', items: { type: 'number' } },
      },
      document_count: 0,
    });
    const { types } = await describeTypes(context);
    expect(types.map(({ slug }) => slug)).toContain('energy_bill');
  });

  it('gives the type a parent that has none', async () => {
    await createType(context, { slug: 'bill', description: 'A bill', fields: {} });
    const child = await createType(context, {
      slug: 'water_bill',
      description: 'Bill from a water supplier',
      parent_slug: 'bill',
    });
    expect(child.parent_slug).toBe('bill');
    const refusal = await refusalOf(
      createType(context, { slug: 'tap_bill', description: 'Too deep', parent_slug: 'water_bill' }),
    );
    expect(refusal.code).toBe('hierarchy_too_deep');
  });

  it('refuses a slug that breaks the naming rules, with every violation', async () => {
    const refusal = await refusalOf(
      createType(context, { slug: 'Bill-October', description: 'A bill' }),
    );
    expect(refusal.kind).toBe('invalid');
    expect(refusal.code).toBe('invalid_slug');
    const details = z
      .object({ slug: z.string(), violations: z.array(z.object({ rule: z.string() })) })
      .parse(refusal.details);
    expect(details.slug).toBe('Bill-October');
    expect(details.violations.map(({ rule }) => rule)).toContain('snake_case');
  });

  it('refuses field names the registry refuses, naming the field', async () => {
    const refusal = await refusalOf(
      createType(context, {
        slug: 'phone_bill',
        description: 'Bill from a phone operator',
        fields: { 'Line Number': { type: 'text' } },
      }),
    );
    expect(refusal.code).toBe('invalid_fields');
    expect(refusal.details).toMatchObject({
      issues: [expect.objectContaining({ field: 'Line Number' })],
    });
  });

  it('refuses a definition outside the primitives before the registry sees it', async () => {
    await expect(
      createType(context, {
        slug: 'gas_bill',
        description: 'Bill from a gas supplier',
        // @ts-expect-error: a primitive that does not exist
        fields: { volume: { type: 'object' } },
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a slug or an alias the registry already holds', async () => {
    await database.db
      .update(docTypes)
      .set({ aliases: ['power_bill'] })
      .where(eq(docTypes.slug, 'energy_bill'));
    const duplicate = await refusalOf(
      createType(context, { slug: 'energy_bill', description: 'Again' }),
    );
    expect(duplicate.code).toBe('name_taken');
    expect(duplicate.details).toEqual({ name: 'energy_bill', held_by: 'energy_bill' });
    const alias = await refusalOf(
      createType(context, { slug: 'power_bill', description: 'Again' }),
    );
    expect(alias.details).toEqual({ name: 'power_bill', held_by: 'energy_bill' });
  });

  it('refuses an empty description', async () => {
    const refusal = await refusalOf(createType(context, { slug: 'tax_notice', description: ' ' }));
    expect(refusal.code).toBe('invalid_description');
  });

  it('is not bounded by the daily quota of the pipeline', async () => {
    const slugs = ['rent_receipt', 'pay_slip', 'tax_return', 'bank_statement', 'insurance_policy'];
    const created = await Promise.all(
      slugs.map(async (slug) => createType(context, { slug, description: `A ${slug}` })),
    );
    expect(created).toHaveLength(slugs.length);
  });
});
