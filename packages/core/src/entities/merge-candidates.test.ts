import type { EntityKind } from '@liasse/contract/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { Entity } from './entity-store.ts';
import type { StoredIdentifier } from './identifiers.ts';
import { findMergeCandidates, mergeCandidatesAmong } from './merge-candidates.ts';
import { seedEntity } from './support.test-helper.ts';

const companyId = (value: string): StoredIdentifier => ({ type: 'company_id', value });
const iban = (hash: string): StoredIdentifier => ({ type: 'iban', last4: '0146', hash });
const meter = (value: string): StoredIdentifier => ({ type: 'other', format: 'PDL', value });

const entity = (
  id: string,
  canonicalName: string,
  overrides: {
    readonly kind?: EntityKind;
    readonly aliases?: readonly string[];
    readonly identifiers?: readonly StoredIdentifier[];
  } = {},
): Entity => ({ id, kind: 'org', canonicalName, aliases: [], identifiers: [], ...overrides });

describe('mergeCandidatesAmong', () => {
  it('pairs two entities of one kind that share a strong identifier', () => {
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'Synthetic Energy', { identifiers: [companyId('999990001')] }),
        entity('ent_2', 'SE Group', { identifiers: [companyId('999990001')] }),
        entity('ent_3', 'Acme Bank', { identifiers: [iban('aa')] }),
        entity('ent_4', 'Acme Savings', { identifiers: [iban('aa')] }),
      ]),
    ).toEqual([
      { sourceId: 'ent_2', targetId: 'ent_1', reason: 'shared_identifier' },
      { sourceId: 'ent_4', targetId: 'ent_3', reason: 'shared_identifier' },
    ]);
  });

  it('pairs two entities of one kind whose names are equal once normalized', () => {
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'Synthetic Énergie SA'),
        entity('ent_2', 'SYNTHETIC ENERGIE'),
        entity('ent_3', 'Acme', { aliases: ['Acme Widgets Ltd'] }),
        entity('ent_4', 'AW', { aliases: ['acme widgets'] }),
      ]),
    ).toEqual([
      { sourceId: 'ent_2', targetId: 'ent_1', reason: 'same_name' },
      { sourceId: 'ent_4', targetId: 'ent_3', reason: 'same_name' },
    ]);
  });

  it('says the identifier when a pair shares both', () => {
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'Synthetic Energy', { identifiers: [companyId('999990001')] }),
        entity('ent_2', 'synthetic energy', { identifiers: [companyId('999990001')] }),
      ]),
    ).toEqual([{ sourceId: 'ent_2', targetId: 'ent_1', reason: 'shared_identifier' }]);
  });

  it('never pairs an organization with a person', () => {
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'Jane Doe', { kind: 'person', identifiers: [iban('aa')] }),
        entity('ent_2', 'Jane Doe', { identifiers: [iban('aa')] }),
      ]),
    ).toEqual([]);
  });

  it('pairs nothing on an identifier of a free format, on another type or another value', () => {
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'One', { identifiers: [meter('09999999999999'), companyId('999990001')] }),
        entity('ent_2', 'Two', { identifiers: [meter('09999999999999'), companyId('999990002')] }),
        entity('ent_3', 'Three', { identifiers: [{ type: 'vat_number', value: '999990001' }] }),
      ]),
    ).toEqual([]);
  });

  it('pairs nothing on a shared customer number', () => {
    const customerNumber: StoredIdentifier = { type: 'customer_number', value: 'CLT00412' };
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'Synthetic Energy', { identifiers: [customerNumber] }),
        entity('ent_2', 'Synthetic Telecom', { identifiers: [customerNumber] }),
      ]),
    ).toEqual([]);
  });

  it('pairs each entity with the oldest one it is related to, and only that one', () => {
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'Synthetic Energy'),
        entity('ent_2', 'synthetic energy'),
        entity('ent_3', 'SYNTHETIC ENERGY'),
      ]),
    ).toEqual([
      { sourceId: 'ent_2', targetId: 'ent_1', reason: 'same_name' },
      { sourceId: 'ent_3', targetId: 'ent_1', reason: 'same_name' },
    ]);
  });

  it('follows a chain one link at a time', () => {
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'Synthetic Energy'),
        entity('ent_2', 'synthetic energy', { identifiers: [companyId('999990001')] }),
        entity('ent_3', 'SE Group', { identifiers: [companyId('999990001')] }),
      ]),
    ).toEqual([
      { sourceId: 'ent_2', targetId: 'ent_1', reason: 'same_name' },
      { sourceId: 'ent_3', targetId: 'ent_2', reason: 'shared_identifier' },
    ]);
  });

  it('prefers the oldest related entity, whatever relates them', () => {
    expect(
      mergeCandidatesAmong([
        entity('ent_1', 'Synthetic Energy'),
        entity('ent_2', 'SE Group', { identifiers: [companyId('999990001')] }),
        entity('ent_3', 'synthetic energy', { identifiers: [companyId('999990001')] }),
      ]),
    ).toEqual([{ sourceId: 'ent_3', targetId: 'ent_1', reason: 'same_name' }]);
  });
});

describe('findMergeCandidates', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('reads the entities oldest first and gives the same pairs every time', async () => {
    const oldest = await seedEntity(database.db, {
      name: 'Synthetic Energy',
      identifiers: [{ type: 'company_id', value: '999990001' }],
    });
    await seedEntity(database.db, { kind: 'person', name: 'Jane Doe' });
    const byName = await seedEntity(database.db, { name: 'SYNTHETIC ENERGY SA' });
    const byIdentifier = await seedEntity(database.db, {
      name: 'SE Group',
      identifiers: [{ type: 'company_id', value: '999 990 001' }],
    });
    const expected = [
      { sourceId: byName, targetId: oldest, reason: 'same_name' },
      { sourceId: byIdentifier, targetId: oldest, reason: 'shared_identifier' },
    ];
    expect(await findMergeCandidates({ db: database.db })).toEqual(expected);
    expect(await findMergeCandidates({ db: database.db })).toEqual(expected);
  });
});
