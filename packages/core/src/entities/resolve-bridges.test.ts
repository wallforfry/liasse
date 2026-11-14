import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entities, typeChanges } from '../db/schema/registry.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { EntitiesContext } from './context.ts';
import { resolveEntity } from './resolve.ts';
import {
  atSimilarity,
  recordingEmbedder,
  seedEntity,
  SYNTHETIC_IBAN,
  TEST_IDENTIFIER_KEY,
} from './support.test-helper.ts';

const PUBLIC = { allowExternalEmbedding: true } as const;
const PRIVATE = { allowExternalEmbedding: false } as const;

const ALPHA_COMPANY_ID = { type: 'company_id', value: '111111111' } as const;
const BETA_VAT_NUMBER = { type: 'vat_number', value: 'FR22222222222' } as const;

describe('resolveEntity on a mention that bridges entities', () => {
  let database: TestDatabase;

  const context = (overrides: Partial<EntitiesContext> = {}): EntitiesContext => ({
    db: database.db,
    embedder: recordingEmbedder(false),
    textModel: createFakeTextModel([]),
    identifierKey: TEST_IDENTIFIER_KEY,
    ...overrides,
  });

  const proposals = () =>
    database.db
      .select({
        kind: typeChanges.kind,
        payload: typeChanges.payload,
        rationale: typeChanges.rationale,
        status: typeChanges.status,
        auto: typeChanges.auto,
      })
      .from(typeChanges);

  const identifiersOf = async (id: string): Promise<unknown> => {
    const [row] = await database.db
      .select({ identifiers: entities.identifiers })
      .from(entities)
      .where(eq(entities.id, id));
    return row?.identifiers;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.db.delete(typeChanges);
    await database.db.delete(entities);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('records one proposal that needs an approval for the two entities it designates', async () => {
    const alpha = await seedEntity(database.db, {
      name: 'Alpha Energy',
      identifiers: [ALPHA_COMPANY_ID],
    });
    const beta = await seedEntity(database.db, {
      name: 'Beta Telecom',
      identifiers: [BETA_VAT_NUMBER],
    });
    const mention = { name: 'Alpha Energy', identifiers: [ALPHA_COMPANY_ID, BETA_VAT_NUMBER] };
    await resolveEntity(context(), mention, PRIVATE);
    await resolveEntity(context(), mention, PRIVATE);
    expect(await proposals()).toEqual([
      {
        kind: 'merge_entity',
        payload: { source_id: beta, target_id: alpha },
        rationale:
          'One mention carried an identifier of "Beta Telecom" and one of "Alpha Energy"; nothing else says they are one entity.',
        status: 'pending',
        auto: false,
      },
    ]);
  });

  it('does not record it again once it was rejected', async () => {
    await seedEntity(database.db, { name: 'Alpha Energy', identifiers: [ALPHA_COMPANY_ID] });
    await seedEntity(database.db, { name: 'Beta Telecom', identifiers: [BETA_VAT_NUMBER] });
    const mention = { name: 'Gamma Water', identifiers: [ALPHA_COMPANY_ID, BETA_VAT_NUMBER] };
    await resolveEntity(context(), mention, PRIVATE);
    await database.db.update(typeChanges).set({ status: 'rejected' });
    await resolveEntity(context(), mention, PRIVATE);
    expect((await proposals()).map(({ status }) => status)).toEqual(['rejected']);
  });

  it('records a proposal with the entity of another kind that carries the identifier', async () => {
    const iban = { type: 'iban', value: SYNTHETIC_IBAN } as const;
    const person = await seedEntity(database.db, {
      kind: 'person',
      name: 'Jane Doe',
      identifiers: [iban],
    });
    const resolution = await resolveEntity(
      context(),
      { name: 'Doe Consulting', kind: 'org', identifiers: [iban] },
      PRIVATE,
    );
    expect(resolution.match).toBe('created');
    expect(await proposals()).toEqual([
      {
        kind: 'merge_entity',
        payload: { source_id: resolution.entity_id, target_id: person },
        rationale:
          'A mention of "Doe Consulting" (org) carried an identifier of "Jane Doe" (person); a merge needs both to be of one kind.',
        status: 'pending',
        auto: false,
      },
    ]);
  });

  it('records nothing for a mention that designates one entity of its kind', async () => {
    const alpha = await seedEntity(database.db, {
      name: 'Alpha Energy',
      identifiers: [ALPHA_COMPANY_ID],
    });
    expect(
      await resolveEntity(
        context(),
        { name: 'Another Spelling', identifiers: [ALPHA_COMPANY_ID] },
        PRIVATE,
      ),
    ).toMatchObject({ entity_id: alpha, match: 'identifier' });
    expect(await proposals()).toEqual([]);
  });

  it('does not add to an entity matched by identifier a company id that differs from its own', async () => {
    const alpha = await seedEntity(database.db, {
      name: 'Alpha Energy',
      identifiers: [ALPHA_COMPANY_ID, BETA_VAT_NUMBER],
    });
    const resolution = await resolveEntity(
      context(),
      {
        name: 'Alpha Energy',
        identifiers: [
          BETA_VAT_NUMBER,
          { type: 'company_id', value: '333333333' },
          { type: 'customer_number', value: 'CLT-00412' },
        ],
      },
      PRIVATE,
    );
    expect(resolution).toMatchObject({ entity_id: alpha, match: 'identifier' });
    expect(await identifiersOf(alpha)).toEqual({
      items: [ALPHA_COMPANY_ID, BETA_VAT_NUMBER, { type: 'customer_number', value: 'CLT00412' }],
    });
  });

  it('looks past the closest entities that carry another company id', async () => {
    const namesakes = await Promise.all(
      [0.99, 0.98, 0.97].map((cosine, index) =>
        seedEntity(database.db, {
          name: `Dupont ${String(index)}`,
          identifiers: [{ type: 'company_id', value: `11111111${String(index)}` }],
          embedding: atSimilarity(cosine, index + 1),
        }),
      ),
    );
    const compatible = await seedEntity(database.db, {
      name: 'Dupond Compatible',
      embedding: atSimilarity(0.95, 5),
    });
    const resolution = await resolveEntity(
      context({ embedder: recordingEmbedder() }),
      { name: 'Dupond', identifiers: [{ type: 'company_id', value: '222222222' }] },
      PUBLIC,
    );
    expect(resolution).toMatchObject({ entity_id: compatible, match: 'similarity' });
    expect(namesakes).not.toContain(resolution.entity_id);
  });
});
