import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOMBSTONE_STATUS } from '../domain/enums.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { getEntity, listEntities, type ListEntitiesOptions } from './list.ts';
import { seedEntity, SYNTHETIC_IBAN } from './support.test-helper.ts';

describe('listEntities', () => {
  let database: TestDatabase;
  let energy: string;
  let bank: string;
  let jane: string;
  let acme: string;

  const names = async (options: ListEntitiesOptions = {}): Promise<readonly string[]> =>
    (await listEntities({ db: database.db }, options)).entities.map(
      ({ canonicalName }) => canonicalName,
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    energy = await seedEntity(database.db, {
      name: 'Synthetic Énergie SA',
      aliases: ['S.E.', 'Électricité de Synthèse'],
      identifiers: [
        { type: 'company_id', value: '999990001' },
        { type: 'iban', value: SYNTHETIC_IBAN },
        { type: 'other', format: 'PDL', value: '09999999999999' },
      ],
    });
    bank = await seedEntity(database.db, { name: 'Banque Synthétique' });
    jane = await seedEntity(database.db, { kind: 'person', name: 'Jane Doe' });
    acme = await seedEntity(database.db, { name: 'acme widgets ltd' });
    await seedEntity(database.db, { name: 'Синтез' });

    const by = (entityId: string) => ({ entity_id: entityId, match: 'name', confidence: 0.99 });
    const document = (provenance: Readonly<Record<string, unknown>>) =>
      insertSyntheticDocument(database.db, { provenance });
    await document({ issuer: by(energy), recipient: by(jane) });
    await document({ issuer: by(energy) });
    await document({ issuer: by(jane), recipient: by(jane) });
    await document({ insurer: by(bank), parties: [by(acme)] });
    await insertSyntheticDocument(database.db, { core: { issuer: acme, recipient: acme } });
    await insertSyntheticDocument(database.db, {
      private: true,
      provenance: { issuer: by(energy), parties: [by(jane)] },
    });
    // A real tombstone has no provenance left; this one keeps it, so that only its status
    // can keep it out of the count.
    await insertSyntheticDocument(database.db, {
      status: TOMBSTONE_STATUS,
      provenance: { issuer: by(energy) },
    });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('lists every entity by normalized name, with aliases, identifiers and document count', async () => {
    const { entities, total } = await listEntities({ db: database.db });
    expect(total).toBe(5);
    expect(entities.map(({ canonicalName }) => canonicalName)).toEqual([
      'acme widgets ltd',
      'Banque Synthétique',
      'Jane Doe',
      'Synthetic Énergie SA',
      'Синтез',
    ]);
    expect(entities.find(({ id }) => id === energy)).toEqual({
      id: energy,
      kind: 'org',
      canonicalName: 'Synthetic Énergie SA',
      aliases: ['S.E.', 'Électricité de Synthèse'],
      identifiers: [
        { type: 'company_id', value: '999990001' },
        { type: 'iban', value: '****0146' },
        { type: 'other', format: 'PDL', value: '09999999999999' },
      ],
      documentCount: 2,
    });
  });

  const counts = async (options: ListEntitiesOptions = {}) => {
    const { entities } = await listEntities({ db: database.db }, options);
    return Object.fromEntries(entities.map(({ id, documentCount }) => [id, documentCount]));
  };

  it('counts the documents that name an entity in any field, once each', async () => {
    expect(await counts()).toMatchObject({ [energy]: 2, [jane]: 2, [bank]: 1, [acme]: 1 });
  });

  it('counts private documents only when asked to', async () => {
    expect(await counts({ includePrivate: true })).toMatchObject({
      [energy]: 3,
      [jane]: 3,
      [bank]: 1,
      [acme]: 1,
    });
    expect(await counts({ includePrivate: false })).toMatchObject({ [energy]: 2, [jane]: 2 });
  });

  it('filters by kind', async () => {
    expect(await names({ kind: 'person' })).toEqual(['Jane Doe']);
    expect(await names({ kind: 'org' })).not.toContain('Jane Doe');
  });

  it.each([
    ['the canonical name, without case, accents or legal form', 'SYNTHETIC ENERGIE S.A.S.'],
    ['the start of each word, in any order', 'ener synth'],
    ['an alias', 'electricite de synthese'],
    ['a dotted alias', 'SE'],
  ])('finds an entity by %s', async (_case, query) => {
    expect(await names({ query })).toEqual(['Synthetic Énergie SA']);
  });

  it('finds nothing for a word that only appears inside one, or with a word too many', async () => {
    expect(await names({ query: 'nergie' })).toEqual([]);
    expect(await names({ query: 'synthetic energie lyon' })).toEqual([]);
    expect(await names({ query: 'synthetic doe' })).toEqual([]);
  });

  it('puts the entity that goes by exactly that name first', async () => {
    const exact = await seedEntity(database.db, { name: 'Synth' });
    const result = await listEntities({ db: database.db }, { query: 'synth' });
    expect(result.entities.map(({ id }) => id)).toEqual([exact, bank, energy]);
    expect(result.total).toBe(3);
    await database.db.execute(sql`DELETE FROM entities WHERE id = ${exact}`);
  });

  it('finds nothing for a query without any letter or digit', async () => {
    expect(await names({ query: '***' })).toEqual([]);
  });

  it('finds a name written in another script by the start of its words', async () => {
    expect(await names({ query: 'синт' })).toEqual(['Синтез']);
  });

  it('combines the query and the kind', async () => {
    expect(await names({ query: 'jane', kind: 'org' })).toEqual([]);
    expect(await names({ query: 'jane', kind: 'person' })).toEqual(['Jane Doe']);
  });

  it('pages through the matches and keeps their total', async () => {
    const page = await listEntities({ db: database.db }, { limit: 2, offset: 1 });
    expect(page.entities.map(({ canonicalName }) => canonicalName)).toEqual([
      'Banque Synthétique',
      'Jane Doe',
    ]);
    expect(page.total).toBe(5);
    expect(page.entities.find(({ id }) => id === jane)?.documentCount).toBe(2);
    expect(await names({ offset: 5 })).toEqual([]);
  });

  it.each([{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { offset: -1 }, { query: '  ' }])(
    'refuses %o',
    async (options) => {
      await expect(listEntities({ db: database.db }, options)).rejects.toThrow();
    },
  );

  describe('getEntity', () => {
    it('answers one entity with its document count', async () => {
      expect(await getEntity({ db: database.db }, jane)).toEqual({
        id: jane,
        kind: 'person',
        canonicalName: 'Jane Doe',
        aliases: [],
        identifiers: [],
        documentCount: 2,
      });
    });

    it('counts private documents only when asked to', async () => {
      expect(await getEntity({ db: database.db }, jane, { includePrivate: true })).toMatchObject({
        documentCount: 3,
      });
    });

    it('answers nothing for an unknown id', async () => {
      expect(await getEntity({ db: database.db }, newId(ID_PREFIXES.entity))).toBeUndefined();
    });
  });
});
