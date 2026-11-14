import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import { entityProvenanceSchema } from '../domain/provenance.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { EntitiesContext } from './context.ts';
import { InvalidEntityMentionError } from './mention.ts';
import { resolveEntity } from './resolve.ts';
import { maskSensitiveIdentifier, type SensitiveIdentifierType } from './sensitive.ts';
import {
  atSimilarity,
  recordingEmbedder,
  seedEntity,
  SYNTHETIC_CARD,
  SYNTHETIC_IBAN,
  TEST_IDENTIFIER_KEY,
} from './support.test-helper.ts';

const hashOf = (type: SensitiveIdentifierType, value: string): string =>
  maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, type, value).hash;

const PUBLIC = { allowExternalEmbedding: true } as const;
const PRIVATE = { allowExternalEmbedding: false } as const;

describe('resolveEntity', () => {
  let database: TestDatabase;

  const context = (overrides: Partial<EntitiesContext> = {}): EntitiesContext => ({
    db: database.db,
    embedder: recordingEmbedder(),
    textModel: createFakeTextModel([]),
    identifierKey: TEST_IDENTIFIER_KEY,
    ...overrides,
  });

  const rowOf = async (id: string) => {
    const [row] = await database.db.select().from(entities).where(eq(entities.id, id));
    if (row === undefined) throw new Error(`No entity ${id}`);
    return row;
  };

  const entityCount = () => database.db.$count(entities);

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.db.delete(entities);
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('creation', () => {
    it('creates the entity when nothing is known, with what the mention says of it', async () => {
      const embedder = recordingEmbedder();
      const resolution = await resolveEntity(
        context({ embedder }),
        {
          name: 'Synthetic Energy SA',
          kind: 'org',
          identifiers: [{ type: 'company_id', value: '999 990 001' }],
          context: 'electricity supplier, Lyon',
        },
        PUBLIC,
      );
      expect(resolution.entity_id).toMatch(/^ent_/);
      expect(resolution).toMatchObject({ match: 'created', confidence: 1 });
      expect(await rowOf(resolution.entity_id)).toMatchObject({
        kind: 'org',
        canonicalName: 'Synthetic Energy SA',
        aliases: [],
        identifiers: { items: [{ type: 'company_id', value: '999990001' }] },
        embedding: atSimilarity(1),
      });
      expect(embedder.texts).toEqual(['Synthetic Energy SA\nelectricity supplier, Lyon']);
    });

    it('embeds the name alone when the mention has no context', async () => {
      const embedder = recordingEmbedder();
      await resolveEntity(context({ embedder }), { name: 'Synthetic Energy' }, PUBLIC);
      expect(embedder.texts).toEqual(['Synthetic Energy']);
    });

    it('creates a person when the mention is one, an organization when it does not say', async () => {
      const person = await resolveEntity(context(), { name: 'Jane Doe', kind: 'person' }, PUBLIC);
      expect((await rowOf(person.entity_id)).kind).toBe('person');
      await database.db.delete(entities);
      const unknown = await resolveEntity(context(), { name: 'Acme Widgets' }, PUBLIC);
      expect((await rowOf(unknown.entity_id)).kind).toBe('org');
    });

    it('never stores an IBAN or a card number in clear', async () => {
      const { entity_id: id } = await resolveEntity(
        context(),
        {
          name: 'Synthetic Bank',
          identifiers: [
            { type: 'iban', value: 'FR75 9999 9000 01SY NTHE TIC0 146' },
            { type: 'card_number', value: '4242-4242-4242-4242' },
          ],
        },
        PUBLIC,
      );
      const { identifiers } = await rowOf(id);
      expect(identifiers).toEqual({
        items: [
          { type: 'iban', last4: '0146', hash: hashOf('iban', SYNTHETIC_IBAN) },
          { type: 'card_number', last4: '4242', hash: hashOf('card_number', SYNTHETIC_CARD) },
        ],
      });
      const stored = JSON.stringify(identifiers);
      expect(stored).not.toContain('9999900001');
      expect(stored).not.toContain('42424242');
    });

    it('refuses a mention without a name', async () => {
      await expect(resolveEntity(context(), { name: '   ' }, PUBLIC)).rejects.toBeInstanceOf(
        InvalidEntityMentionError,
      );
      expect(await entityCount()).toBe(0);
    });

    it('answers with a provenance entry', async () => {
      const resolution = await resolveEntity(context(), { name: 'Synthetic Energy' }, PUBLIC);
      expect(entityProvenanceSchema.parse(resolution)).toEqual(resolution);
      expect(Object.keys(resolution)).toEqual(['entity_id', 'match', 'confidence']);
    });

    it('refuses a mention that is not one, without repeating its values', async () => {
      const failure = resolveEntity(
        context(),
        { name: 'Synthetic', identifiers: [{ type: 'iban', value: SYNTHETIC_IBAN.repeat(4) }] },
        PUBLIC,
      );
      await expect(failure).rejects.toBeInstanceOf(InvalidEntityMentionError);
      await expect(failure).rejects.not.toThrow(/SYNTHETIC0146/);
      expect(await entityCount()).toBe(0);
    });
  });

  describe('rule 1: strong identifier', () => {
    it.each([
      ['company_id', '999990001', '999 990 001'],
      ['vat_number', 'FR00999990001', 'fr 00 999.990.001'],
      ['customer_number', 'CLT-00412', 'clt 00412'],
      ['iban', SYNTHETIC_IBAN, 'fr75 9999 9000 01sy nthe tic0 146'],
      ['card_number', SYNTHETIC_CARD, '4242 4242 4242 4242'],
    ] as const)('attaches on a known %s, however it is written', async (type, known, written) => {
      const id = await seedEntity(database.db, {
        name: 'Synthetic Energy',
        identifiers: [{ type, value: known }],
      });
      const embedder = recordingEmbedder();
      const resolution = await resolveEntity(
        context({ embedder }),
        { name: 'A Completely Different Name', identifiers: [{ type, value: written }] },
        PUBLIC,
      );
      expect(resolution).toEqual({ entity_id: id, match: 'identifier', confidence: 1 });
      expect(await entityCount()).toBe(1);
      expect((await rowOf(id)).aliases).toEqual([]);
      expect(embedder.texts).toEqual([]);
    });

    it('does not attach on a customer number shorter than six characters', async () => {
      await seedEntity(database.db, {
        name: 'Synthetic Energy',
        identifiers: [{ type: 'customer_number', value: '00412' }],
      });
      const resolution = await resolveEntity(
        context(),
        { name: 'Acme Widgets', identifiers: [{ type: 'customer_number', value: '00412' }] },
        PUBLIC,
      );
      expect(resolution.match).toBe('created');
    });

    it('attaches on a customer number of six characters', async () => {
      const id = await seedEntity(database.db, {
        name: 'Synthetic Energy',
        identifiers: [{ type: 'customer_number', value: '000412' }],
      });
      const resolution = await resolveEntity(
        context(),
        { name: 'Acme Widgets', identifiers: [{ type: 'customer_number', value: '000412' }] },
        PUBLIC,
      );
      expect(resolution).toMatchObject({ entity_id: id, match: 'identifier' });
    });

    it('lets the name decide when two entities of one kind carry the customer number', async () => {
      const customerNumber = { type: 'customer_number', value: 'CLT-00412' } as const;
      await seedEntity(database.db, { name: 'Synthetic Energy', identifiers: [customerNumber] });
      const telecom = await seedEntity(database.db, {
        name: 'Synthetic Telecom',
        identifiers: [customerNumber],
      });
      expect(
        await resolveEntity(
          context(),
          { name: 'SYNTHETIC TELECOM SA', identifiers: [customerNumber] },
          PUBLIC,
        ),
      ).toMatchObject({ entity_id: telecom, match: 'name' });
      expect(
        await resolveEntity(
          context(),
          { name: 'Acme Widgets', identifiers: [customerNumber] },
          PUBLIC,
        ),
      ).toMatchObject({ match: 'created' });
    });

    it('attaches on a customer number carried by one entity of each kind', async () => {
      const customerNumber = { type: 'customer_number', value: 'CLT-00412' } as const;
      const person = await seedEntity(database.db, {
        kind: 'person',
        name: 'Jane Doe',
        identifiers: [customerNumber],
      });
      const org = await seedEntity(database.db, {
        name: 'Synthetic Energy',
        identifiers: [customerNumber],
      });
      expect(
        await resolveEntity(
          context(),
          { name: 'Acme Widgets', identifiers: [customerNumber] },
          PUBLIC,
        ),
      ).toMatchObject({ entity_id: person, match: 'identifier' });
      expect(
        await resolveEntity(
          context(),
          { name: 'Acme Widgets', kind: 'org', identifiers: [customerNumber] },
          PUBLIC,
        ),
      ).toMatchObject({ entity_id: org, match: 'identifier' });
    });

    it('comes before the name', async () => {
      const byIdentifier = await seedEntity(database.db, {
        name: 'Synthetic Energy',
        identifiers: [{ type: 'company_id', value: '999990001' }],
      });
      await seedEntity(database.db, { name: 'Acme Widgets' });
      const resolution = await resolveEntity(
        context(),
        { name: 'Acme Widgets', identifiers: [{ type: 'company_id', value: '999990001' }] },
        PUBLIC,
      );
      expect(resolution).toMatchObject({ entity_id: byIdentifier, match: 'identifier' });
    });

    it('does not attach on an identifier of another type with the same value', async () => {
      await seedEntity(database.db, {
        name: 'Synthetic Energy',
        identifiers: [{ type: 'company_id', value: '999990001' }],
      });
      const resolution = await resolveEntity(
        context(),
        { name: 'Acme Widgets', identifiers: [{ type: 'customer_number', value: '999990001' }] },
        PUBLIC,
      );
      expect(resolution.match).toBe('created');
    });

    it('does not attach on an identifier of a free format', async () => {
      await seedEntity(database.db, {
        name: 'Synthetic Energy',
        identifiers: [{ type: 'other', format: 'PDL', value: '09999999999999' }],
      });
      const resolution = await resolveEntity(
        context(),
        {
          name: 'Acme Widgets',
          identifiers: [{ type: 'other', format: 'PDL', value: '09999999999999' }],
        },
        PUBLIC,
      );
      expect(resolution.match).toBe('created');
    });
  });

  describe('rule 2: normalized name', () => {
    it('attaches on the canonical name without case, accents or legal form', async () => {
      const id = await seedEntity(database.db, { name: 'Synthetic Énergie SA' });
      const embedder = recordingEmbedder();
      const resolution = await resolveEntity(
        context({ embedder }),
        { name: 'SYNTHETIC ENERGIE S.A.S.' },
        PUBLIC,
      );
      expect(resolution).toEqual({ entity_id: id, match: 'name', confidence: 0.99 });
      expect(await entityCount()).toBe(1);
      expect(embedder.texts).toEqual([]);
    });

    it('attaches on an alias and says so', async () => {
      const id = await seedEntity(database.db, {
        name: 'SE',
        aliases: ['Synthetic Energy Ltd'],
      });
      const resolution = await resolveEntity(context(), { name: 'synthetic energy' }, PUBLIC);
      expect(resolution).toEqual({ entity_id: id, match: 'alias', confidence: 0.99 });
    });

    it('prefers the entity whose canonical name it is over one that has it as an alias', async () => {
      await seedEntity(database.db, { name: 'Acme Holding', aliases: ['Acme'] });
      const canonical = await seedEntity(database.db, { name: 'Acme' });
      const resolution = await resolveEntity(context(), { name: 'ACME Inc.' }, PUBLIC);
      expect(resolution).toMatchObject({ entity_id: canonical, match: 'name' });
    });

    it('keeps the identifiers a later mention brings, and matches on them afterwards', async () => {
      const id = await seedEntity(database.db, { name: 'Synthetic Energy' });
      await resolveEntity(
        context(),
        {
          name: 'Synthetic Energy SA',
          identifiers: [{ type: 'customer_number', value: 'CLT-00412' }],
        },
        PUBLIC,
      );
      expect((await rowOf(id)).identifiers).toEqual({
        items: [{ type: 'customer_number', value: 'CLT00412' }],
      });
      const resolution = await resolveEntity(
        context(),
        { name: 'Another Name', identifiers: [{ type: 'customer_number', value: 'CLT00412' }] },
        PUBLIC,
      );
      expect(resolution).toMatchObject({ entity_id: id, match: 'identifier' });
    });
  });

  describe('kinds', () => {
    it('never attaches an organization to a person of the same name', async () => {
      const person = await seedEntity(database.db, { kind: 'person', name: 'Jane Doe' });
      const resolution = await resolveEntity(context(), { name: 'Jane Doe', kind: 'org' }, PUBLIC);
      expect(resolution.match).toBe('created');
      expect(resolution.entity_id).not.toBe(person);
    });

    it('never attaches across kinds on an identifier', async () => {
      await seedEntity(database.db, {
        kind: 'person',
        name: 'Jane Doe',
        identifiers: [{ type: 'iban', value: SYNTHETIC_IBAN }],
      });
      const resolution = await resolveEntity(
        context(),
        {
          name: 'Acme Widgets',
          kind: 'org',
          identifiers: [{ type: 'iban', value: SYNTHETIC_IBAN }],
        },
        PUBLIC,
      );
      expect(resolution.match).toBe('created');
    });

    it('never attaches across kinds on similarity', async () => {
      await seedEntity(database.db, {
        kind: 'person',
        name: 'Jane Doe',
        embedding: atSimilarity(0.99),
      });
      const resolution = await resolveEntity(context(), { name: 'J. Doe', kind: 'org' }, PUBLIC);
      expect(resolution.match).toBe('created');
    });

    it('attaches a mention without a kind to an entity of any kind', async () => {
      const person = await seedEntity(database.db, { kind: 'person', name: 'Jane Doe' });
      const resolution = await resolveEntity(context(), { name: 'jane doe' }, PUBLIC);
      expect(resolution).toMatchObject({ entity_id: person, match: 'name' });
    });
  });

  describe('concurrency', () => {
    const CALLS = 8;

    it('creates one entity for the same new name mentioned at the same time', async () => {
      const spellings = ['Synthetic Energy SA', 'SYNTHETIC ENERGY', 'synthetic énergy s.a.s.'];
      const resolutions = await Promise.all(
        Array.from({ length: CALLS }, (_, index) =>
          resolveEntity(
            context({ embedder: recordingEmbedder(false) }),
            { name: spellings[index % spellings.length] ?? '' },
            PRIVATE,
          ),
        ),
      );
      expect(await entityCount()).toBe(1);
      expect(new Set(resolutions.map(({ entity_id: id }) => id)).size).toBe(1);
      expect(resolutions.filter(({ match }) => match === 'created')).toHaveLength(1);
      expect(resolutions.filter(({ match }) => match === 'name')).toHaveLength(CALLS - 1);
    });

    it('creates one entity for the same new identifier under different names', async () => {
      const resolutions = await Promise.all(
        Array.from({ length: CALLS }, (_, index) =>
          resolveEntity(
            context({ embedder: recordingEmbedder(false) }),
            {
              name: `Distinct Name ${String(index)}`,
              identifiers: [{ type: 'company_id', value: '999990001' }],
            },
            PRIVATE,
          ),
        ),
      );
      expect(await entityCount()).toBe(1);
      expect(resolutions.filter(({ match }) => match === 'identifier')).toHaveLength(CALLS - 1);
    });
  });
});
