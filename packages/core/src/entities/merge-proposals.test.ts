import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities, typeChanges } from '../db/schema/registry.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { withEntityLock } from './entity-lock.ts';
import { mergeEntities } from './merge.ts';
import { proposeEntityMerge, type ProposeEntityMergeInput } from './merge-proposals.ts';
import {
  seedEntity,
  SYNTHETIC_IBAN,
  untilSomeoneWaitsForTheEntityLock,
} from './support.test-helper.ts';

describe('proposeEntityMerge', () => {
  let database: TestDatabase;

  const propose = (input: ProposeEntityMergeInput) =>
    proposeEntityMerge({ db: database.db }, input);

  const proposed = async (input: ProposeEntityMergeInput) => {
    const result = await propose(input);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };

  const changeCount = () => database.db.$count(typeChanges);

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('records a pending merge_entity change, automatic when a strong identifier is shared', async () => {
    const targetId = await seedEntity(database.db, {
      name: 'Synthetic Energy',
      identifiers: [{ type: 'company_id', value: '999990001' }],
    });
    const sourceId = await seedEntity(database.db, {
      name: 'SE Group',
      identifiers: [{ type: 'company_id', value: '999 990 001' }],
    });
    const { proposal, created } = await proposed({ sourceId, targetId });
    expect(created).toBe(true);
    expect(proposal.id).toMatch(/^chg_/);
    expect(proposal).toEqual({
      id: proposal.id,
      payload: { source_id: sourceId, target_id: targetId },
      rationale: '"SE Group" and "Synthetic Energy" carry the same company id 999990001.',
      status: 'pending',
      auto: true,
    });
    const [row] = await database.db
      .select()
      .from(typeChanges)
      .where(eq(typeChanges.id, proposal.id));
    expect(row).toMatchObject({
      kind: 'merge_entity',
      payload: { source_id: sourceId, target_id: targetId },
      status: 'pending',
      auto: true,
    });
    expect(await database.db.$count(entities)).toBe(2);
  });

  it('names a shared IBAN by its last characters only', async () => {
    const targetId = await seedEntity(database.db, {
      name: 'Acme Bank',
      identifiers: [{ type: 'iban', value: SYNTHETIC_IBAN }],
    });
    const sourceId = await seedEntity(database.db, {
      name: 'Acme Savings',
      identifiers: [{ type: 'iban', value: SYNTHETIC_IBAN }],
    });
    const { proposal } = await proposed({ sourceId, targetId });
    expect(proposal.auto).toBe(true);
    expect(proposal.rationale).toBe(
      '"Acme Savings" and "Acme Bank" carry the same iban ending in 0146.',
    );
  });

  it('needs an approval when only a customer number is shared', async () => {
    const customerNumber = { type: 'customer_number', value: 'CLT-00412' } as const;
    const targetId = await seedEntity(database.db, {
      name: 'Customer One',
      identifiers: [customerNumber],
    });
    const sourceId = await seedEntity(database.db, {
      name: 'Customer Two',
      identifiers: [customerNumber],
    });
    const { proposal } = await proposed({ sourceId, targetId });
    expect(proposal.auto).toBe(false);
    expect(proposal.rationale).toBe(
      '"Customer Two" and "Customer One" share no global identifier and no normalized name.',
    );
  });

  it('records the proposal in the transaction of the caller', async () => {
    const targetId = await seedEntity(database.db, { name: 'Caller One' });
    const sourceId = await seedEntity(database.db, { name: 'Caller Two' });
    const before = await changeCount();
    await expect(
      database.db.transaction(async (tx) => {
        const result = await proposeEntityMerge({ db: tx }, { sourceId, targetId });
        expect(result).toMatchObject({ ok: true, value: { created: true } });
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(await changeCount()).toBe(before);
    await database.db.transaction((tx) => proposeEntityMerge({ db: tx }, { sourceId, targetId }));
    expect(await changeCount()).toBe(before + 1);
  });

  it('needs an approval when only the name is shared', async () => {
    const targetId = await seedEntity(database.db, { name: 'Acme Widgets' });
    const sourceId = await seedEntity(database.db, { name: 'ACME WIDGETS LTD' });
    const { proposal } = await proposed({ sourceId, targetId });
    expect(proposal.auto).toBe(false);
    expect(proposal.rationale).toBe(
      '"ACME WIDGETS LTD" and "Acme Widgets" go by the same name once normalized, and share no global identifier.',
    );
  });

  it('needs an approval when only an identifier of a free format is shared', async () => {
    const meter = { type: 'other', format: 'PDL', value: '09999999999999' } as const;
    const targetId = await seedEntity(database.db, { name: 'Meter One', identifiers: [meter] });
    const sourceId = await seedEntity(database.db, { name: 'Meter Two', identifiers: [meter] });
    const { proposal } = await proposed({ sourceId, targetId });
    expect(proposal.auto).toBe(false);
    expect(proposal.rationale).toBe(
      '"Meter Two" and "Meter One" share no global identifier and no normalized name.',
    );
  });

  it('keeps the rationale of the caller', async () => {
    const targetId = await seedEntity(database.db, { name: 'Rationale One' });
    const sourceId = await seedEntity(database.db, { name: 'Rationale Two' });
    const { proposal } = await proposed({ sourceId, targetId, rationale: 'Same address.' });
    expect(proposal).toMatchObject({ rationale: 'Same address.', auto: false });
  });

  it('proposes a pair once, in either direction and whatever became of the proposal', async () => {
    const targetId = await seedEntity(database.db, { name: 'Once One' });
    const sourceId = await seedEntity(database.db, { name: 'Once Two' });
    const first = await proposed({ sourceId, targetId });
    const before = await changeCount();
    expect(await proposed({ sourceId, targetId })).toEqual({ ...first, created: false });
    expect(await proposed({ sourceId: targetId, targetId: sourceId })).toEqual({
      ...first,
      created: false,
    });
    await database.db
      .update(typeChanges)
      .set({ status: 'rejected' })
      .where(eq(typeChanges.id, first.proposal.id));
    expect(await proposed({ sourceId, targetId })).toEqual({
      proposal: { ...first.proposal, status: 'rejected' },
      created: false,
    });
    expect(await changeCount()).toBe(before);
  });

  it('does not propose again a rejected pair after one side was merged into another entity', async () => {
    const kept = await seedEntity(database.db, { name: 'Refused Kept' });
    const merged = await seedEntity(database.db, { name: 'Refused Merged' });
    const absorber = await seedEntity(database.db, { name: 'Refused Absorber' });
    const { proposal } = await proposed({ sourceId: merged, targetId: kept });
    await database.db
      .update(typeChanges)
      .set({ status: 'rejected' })
      .where(eq(typeChanges.id, proposal.id));
    await mergeEntities({ db: database.db }, { sourceId: merged, targetId: absorber });
    expect(await proposed({ sourceId: absorber, targetId: kept })).toMatchObject({
      created: false,
      proposal: { id: proposal.id, status: 'rejected' },
    });
    expect((await proposed({ sourceId: kept, targetId: absorber })).created).toBe(false);
  });

  it('proposes one change for the same pair proposed at the same time', async () => {
    const targetId = await seedEntity(database.db, { name: 'Concurrent One' });
    const sourceId = await seedEntity(database.db, { name: 'Concurrent Two' });
    const before = await changeCount();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => proposed({ sourceId, targetId })),
    );
    expect(results.filter(({ created }) => created)).toHaveLength(1);
    expect(await changeCount()).toBe(before + 1);
  });

  it('waits for the entity lock before it reads the pair', async () => {
    const targetId = await seedEntity(database.db, { name: 'Locked One' });
    const sourceId = await seedEntity(database.db, { name: 'Locked Two' });
    const pending = await database.db.transaction((tx) =>
      withEntityLock(tx, async (locked) => {
        const proposal = propose({ sourceId, targetId });
        await untilSomeoneWaitsForTheEntityLock(database.db);
        await locked.delete(entities).where(eq(entities.id, sourceId));
        return { proposal };
      }),
    );
    expect(await pending.proposal).toMatchObject({
      ok: false,
      error: { code: 'entity_not_found', id: sourceId },
    });
  });

  it('does not take the proposal of another pair for this one', async () => {
    const targetId = await seedEntity(database.db, { name: 'Pair One' });
    const sourceId = await seedEntity(database.db, { name: 'Pair Two' });
    const thirdId = await seedEntity(database.db, { name: 'Pair Three' });
    await proposed({ sourceId, targetId });
    expect((await proposed({ sourceId: thirdId, targetId })).created).toBe(true);
    expect((await proposed({ sourceId, targetId: thirdId })).created).toBe(true);
  });

  it('does not take a change of another kind for a proposal of the pair', async () => {
    const targetId = await seedEntity(database.db, { name: 'Kind One' });
    const sourceId = await seedEntity(database.db, { name: 'Kind Two' });
    await database.db.insert(typeChanges).values({
      kind: 'merge_subject',
      payload: { source_id: sourceId, target_id: targetId },
      rationale: 'Synthetic rationale.',
    });
    expect((await proposed({ sourceId, targetId })).created).toBe(true);
  });

  it('refuses what a merge would refuse, and records nothing', async () => {
    const org = await seedEntity(database.db, { name: 'Refused Org' });
    const person = await seedEntity(database.db, { kind: 'person', name: 'Refused Person' });
    const unknown = newId(ID_PREFIXES.entity);
    const before = await changeCount();
    expect(await propose({ sourceId: org, targetId: org })).toMatchObject({
      ok: false,
      error: { code: 'self_merge' },
    });
    expect(await propose({ sourceId: person, targetId: org })).toMatchObject({
      ok: false,
      error: { code: 'kind_mismatch' },
    });
    expect(await propose({ sourceId: unknown, targetId: org })).toMatchObject({
      ok: false,
      error: { code: 'entity_not_found', id: unknown },
    });
    expect(await changeCount()).toBe(before);
  });
});
