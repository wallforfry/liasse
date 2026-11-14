import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { EntitiesContext } from './context.ts';
import { findMergeCandidates } from './merge-candidates.ts';
import { proposeEntityMerge } from './merge-proposals.ts';
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

describe('resolveEntity against conflicting identifiers', () => {
  let database: TestDatabase;

  // No similarity: these tests are about the identifier and name rules.
  const context = (overrides: Partial<EntitiesContext> = {}): EntitiesContext => ({
    db: database.db,
    embedder: recordingEmbedder(false),
    textModel: createFakeTextModel([]),
    identifierKey: TEST_IDENTIFIER_KEY,
    ...overrides,
  });

  const identifiersOf = async (id: string): Promise<unknown> => {
    const [row] = await database.db
      .select({ identifiers: entities.identifiers })
      .from(entities)
      .where(eq(entities.id, id));
    return row?.identifiers;
  };

  const seedAlphaAndBeta = async () => ({
    alpha: await seedEntity(database.db, { name: 'Alpha Energy', identifiers: [ALPHA_COMPANY_ID] }),
    beta: await seedEntity(database.db, { name: 'Beta Telecom', identifiers: [BETA_VAT_NUMBER] }),
  });

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.db.delete(entities);
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('one mention that carries the identifiers of two entities', () => {
    it('attaches by its name and gives neither entity the identifier of the other', async () => {
      const { alpha, beta } = await seedAlphaAndBeta();
      const resolution = await resolveEntity(
        context(),
        { name: 'ALPHA ENERGY SA', identifiers: [ALPHA_COMPANY_ID, BETA_VAT_NUMBER] },
        PRIVATE,
      );
      expect(resolution).toMatchObject({ entity_id: alpha, match: 'name' });
      expect(await identifiersOf(alpha)).toEqual({ items: [ALPHA_COMPANY_ID] });
      expect(await identifiersOf(beta)).toEqual({ items: [BETA_VAT_NUMBER] });
    });

    it('leaves a later mention of the second entity to the second entity', async () => {
      const { beta } = await seedAlphaAndBeta();
      await resolveEntity(
        context(),
        { name: 'Alpha Energy', identifiers: [ALPHA_COMPANY_ID, BETA_VAT_NUMBER] },
        PRIVATE,
      );
      const later = await resolveEntity(
        context(),
        { name: 'Some Other Spelling', identifiers: [BETA_VAT_NUMBER] },
        PRIVATE,
      );
      expect(later).toMatchObject({ entity_id: beta, match: 'identifier' });
    });

    it('makes the two entities neither merge candidates nor an automatic proposal', async () => {
      const { alpha, beta } = await seedAlphaAndBeta();
      await resolveEntity(
        context(),
        { name: 'Alpha Energy', identifiers: [ALPHA_COMPANY_ID, BETA_VAT_NUMBER] },
        PRIVATE,
      );
      expect(await findMergeCandidates({ db: database.db })).toEqual([]);
      expect(
        await proposeEntityMerge({ db: database.db }, { sourceId: beta, targetId: alpha }),
      ).toMatchObject({ ok: true, value: { proposal: { auto: false } } });
    });

    it('creates an entity without the identifiers others carry when no name matches', async () => {
      await seedAlphaAndBeta();
      const customerNumber = { type: 'customer_number', value: 'CLT-00412' } as const;
      const resolution = await resolveEntity(
        context(),
        { name: 'Gamma Water', identifiers: [ALPHA_COMPANY_ID, BETA_VAT_NUMBER, customerNumber] },
        PRIVATE,
      );
      expect(resolution.match).toBe('created');
      expect(await identifiersOf(resolution.entity_id)).toEqual({
        items: [{ type: 'customer_number', value: 'CLT00412' }],
      });
      expect(await findMergeCandidates({ db: database.db })).toEqual([]);
    });

    it('does not attach on an identifier that two entities already carry', async () => {
      await seedEntity(database.db, { name: 'First', identifiers: [ALPHA_COMPANY_ID] });
      await seedEntity(database.db, { name: 'Second', identifiers: [ALPHA_COMPANY_ID] });
      const resolution = await resolveEntity(
        context(),
        { name: 'Third', identifiers: [ALPHA_COMPANY_ID] },
        PRIVATE,
      );
      expect(resolution.match).toBe('created');
      expect(await identifiersOf(resolution.entity_id)).toEqual({ items: [] });
    });
  });

  describe('an attachment by another rule', () => {
    it('does not copy a global identifier an entity of another kind carries', async () => {
      const iban = { type: 'iban', value: SYNTHETIC_IBAN } as const;
      await seedEntity(database.db, { kind: 'person', name: 'Jane Doe', identifiers: [iban] });
      const org = await seedEntity(database.db, { name: 'Doe Consulting' });
      const resolution = await resolveEntity(
        context(),
        { name: 'Doe Consulting', kind: 'org', identifiers: [iban, BETA_VAT_NUMBER] },
        PRIVATE,
      );
      expect(resolution).toMatchObject({ entity_id: org, match: 'name' });
      expect(await identifiersOf(org)).toEqual({ items: [BETA_VAT_NUMBER] });
    });
  });

  describe('a name that matches against a different identifier', () => {
    it.each([
      ['company_id', '111111111', '222222222', '333333333'],
      ['vat_number', 'FR22222222222', 'FR33333333333', 'FR44444444444'],
    ] as const)('creates another entity for a different %s', async (type, known, second, third) => {
      const dupont = await seedEntity(database.db, {
        name: 'Dupont SARL',
        aliases: ['Maison Dupont'],
        identifiers: [{ type, value: known }],
      });
      const byName = await resolveEntity(
        context(),
        { name: 'Dupont SAS', identifiers: [{ type, value: second }] },
        PRIVATE,
      );
      const byAlias = await resolveEntity(
        context(),
        { name: 'MAISON DUPONT', identifiers: [{ type, value: third }] },
        PRIVATE,
      );
      expect(byName.match).toBe('created');
      expect(byAlias.match).toBe('created');
      expect(await identifiersOf(dupont)).toEqual({ items: [{ type, value: known }] });
      expect(await identifiersOf(byName.entity_id)).toEqual({ items: [{ type, value: second }] });
    });

    it('does not attach by similarity either', async () => {
      await seedEntity(database.db, {
        name: 'Dupont SARL',
        identifiers: [ALPHA_COMPANY_ID],
        embedding: atSimilarity(0.99),
      });
      const resolution = await resolveEntity(
        context({ embedder: recordingEmbedder() }),
        { name: 'Dupond', identifiers: [{ type: 'company_id', value: '222222222' }] },
        PUBLIC,
      );
      expect(resolution.match).toBe('created');
    });

    it('still attaches when the entity has no identifier of that type', async () => {
      const dupont = await seedEntity(database.db, {
        name: 'Dupont SARL',
        identifiers: [BETA_VAT_NUMBER],
      });
      const resolution = await resolveEntity(
        context(),
        { name: 'Dupont SAS', identifiers: [ALPHA_COMPANY_ID] },
        PRIVATE,
      );
      expect(resolution).toMatchObject({ entity_id: dupont, match: 'name' });
      expect(await identifiersOf(dupont)).toEqual({ items: [BETA_VAT_NUMBER, ALPHA_COMPANY_ID] });
    });

    it.each([
      ['company_id', '5'],
      ['vat_number', 'FR'],
    ] as const)('ignores a %s that is only "%s"', async (type, fragment) => {
      const known = [
        { type: 'company_id', value: '552999999' },
        { type: 'vat_number', value: 'FR22222222222' },
      ] as const;
      const dupont = await seedEntity(database.db, { name: 'Dupont SARL', identifiers: known });
      const resolution = await resolveEntity(
        context(),
        { name: 'Dupont', identifiers: [{ type, value: fragment }] },
        PRIVATE,
      );
      expect(resolution).toMatchObject({ entity_id: dupont, match: 'name' });
      expect(await identifiersOf(dupont)).toEqual({ items: known });
      const stranger = await resolveEntity(
        context(),
        { name: 'A Stranger', identifiers: [{ type, value: `${fragment}99999999` }] },
        PRIVATE,
      );
      expect(stranger.match).toBe('created');
    });

    it('does not hold a shorter number as the company id of the longer one', async () => {
      await seedEntity(database.db, {
        name: 'Dupont SARL',
        identifiers: [{ type: 'company_id', value: '999990001' }],
      });
      const resolution = await resolveEntity(
        context(),
        { name: 'Dupont', identifiers: [{ type: 'company_id', value: '99999000' }] },
        PRIVATE,
      );
      expect(resolution.match).toBe('created');
    });

    it('holds a company id and the longer id of one of its establishments as the same', async () => {
      const dupont = await seedEntity(database.db, {
        name: 'Dupont SARL',
        identifiers: [{ type: 'company_id', value: '999990001' }],
      });
      const resolution = await resolveEntity(
        context(),
        { name: 'Dupont', identifiers: [{ type: 'company_id', value: '999 990 001 00017' }] },
        PRIVATE,
      );
      expect(resolution).toMatchObject({ entity_id: dupont, match: 'name' });
    });
  });

  describe('a sensitive identifier written in the name or the context', () => {
    it('is masked before the name is stored or embedded', async () => {
      const embedder = recordingEmbedder();
      const resolution = await resolveEntity(
        context({ embedder }),
        {
          name: 'Synthetic Bank FR75 9999 9000 01SY NTHE TIC0 146',
          context: 'paid with card 4242 4242 4242 4242',
        },
        PUBLIC,
      );
      const [row] = await database.db
        .select({ name: entities.canonicalName })
        .from(entities)
        .where(eq(entities.id, resolution.entity_id));
      expect(row?.name).toBe('Synthetic Bank ****0146');
      expect(embedder.texts).toEqual(['Synthetic Bank ****0146\npaid with card ****4242']);
    });
  });
});
