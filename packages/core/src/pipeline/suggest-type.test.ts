import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { suggestType, type SuggestTypeDeps } from './suggest-type.ts';

const REQUEST = 'Pay statements from my employer: gross and net pay, the month, the employer.';

describe('suggestType', () => {
  let database: TestDatabase;
  const embedder = createFakeEmbedder();

  const depsWith = (
    output: unknown,
  ): SuggestTypeDeps & {
    readonly textModel: ReturnType<typeof createFakeTextModel>;
  } => ({
    db: database.db,
    embedder,
    textModel: createFakeTextModel([output]),
    settings: { schemaLanguage: 'en' },
  });

  beforeAll(async () => {
    database = await createTestDatabase();
    const context = {
      db: database.db,
      embedder,
      schemaLanguage: 'en' as const,
      maxNewTypesPerDay: 10,
    };
    const created = [
      await createType({ slug: 'bill', description: 'A bill to pay', fields: {} }, context),
      await createType(
        {
          slug: 'energy_bill',
          description: 'Bill from an energy supplier',
          parentSlug: 'bill',
          fields: {},
        },
        context,
      ),
    ];
    expect(created.every(({ ok }) => ok)).toBe(true);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('drafts a type from the request, the registry and the request delimited', async () => {
    const deps = depsWith({
      slug: ' payslip ',
      description: 'Pay statement from an employer',
      parent_slug: null,
      fields: {
        gross_pay: { type: 'money' },
        contract: { type: 'enum', values: ['permanent', 'fixed_term'] },
        readings: { type: 'list', items: { type: 'number' } },
      },
    });

    expect(await suggestType(deps, REQUEST)).toEqual({
      slug: 'payslip',
      description: 'Pay statement from an employer',
      parent_slug: null,
      fields: {
        gross_pay: { type: 'money' },
        contract: { type: 'enum', values: ['permanent', 'fixed_term'] },
        readings: { type: 'list', items: { type: 'number' } },
      },
    });
    const [call] = deps.textModel.calls;
    expect(call?.system).toContain('written in English');
    expect(call?.prompt).toMatch(/UNTRUSTED-DATA[\s\S]*- bill: A bill to pay/);
    expect(call?.prompt).toMatch(/UNTRUSTED-DATA[^\n]*\n[^\n]*Pay statements from my employer/);
  });

  it('keeps a listed parent without a parent, and nothing else', async () => {
    const draftWith = async (parent: string) =>
      suggestType(
        depsWith({
          slug: 'water_bill',
          description: 'Water bill',
          parent_slug: parent,
          fields: {},
        }),
        REQUEST,
      );

    expect((await draftWith('bill')).parent_slug).toBe('bill');
    expect((await draftWith('energy_bill')).parent_slug).toBeNull();
    expect((await draftWith('invented')).parent_slug).toBeNull();
  });

  it('leaves out the core fields and the definitions the registry would refuse', async () => {
    const draft = await suggestType(
      depsWith({
        slug: 'payslip',
        description: 'Pay statement',
        fields: {
          issuer: { type: 'entity' },
          net_pay: { type: 'money' },
          mood: { type: 'feeling' },
          grade: { type: 'enum', values: [] },
        },
      }),
      REQUEST,
    );

    expect(draft.fields).toEqual({ net_pay: { type: 'money' } });
  });
});
