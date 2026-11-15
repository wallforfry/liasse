import type { ChangeKind, ChangeStatus } from '@liasse/contract/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { facts } from '../db/schema/knowledge.ts';
import { typeChanges } from '../db/schema/registry.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { atSimilarity, SYNTHETIC_IBAN } from '../entities/support.test-helper.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { columnsHolding } from '../testing/column-scan.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { mergeSubjects } from './subject-merge.ts';
import { findSubjectMergeCandidates } from './subject-merge-candidates.ts';
import { proposeSubjectMerge } from './subject-merge-proposals.ts';
import { missingSubjectIds } from './subject-store.ts';
import { documentRow, seedSubject, subjectRow } from './support.test-helper.ts';

describe('merging subjects', () => {
  let database: TestDatabase;

  const merge = (sourceId: string, targetId: string) =>
    mergeSubjects({ db: database.db }, { sourceId, targetId });

  const factAbout = async (subjectIds: readonly string[]): Promise<string> => {
    const document = await insertSyntheticDocument(database.db);
    const [row] = await database.db
      .insert(facts)
      .values({ documentId: document.id, text: 'A synthetic fact.', subjectIds })
      .returning({ id: facts.id });
    return row?.id ?? '';
  };

  const subjectIdsOfFact = async (id: string): Promise<readonly string[]> => {
    const [row] = await database.db
      .select({ subjectIds: facts.subjectIds })
      .from(facts)
      .where(eq(facts.id, id));
    return row?.subjectIds ?? [];
  };

  const change = async (
    payload: Readonly<Record<string, unknown>>,
    status: ChangeStatus = 'pending',
    kind: ChangeKind = 'merge_subject',
  ): Promise<string> => {
    const [row] = await database.db
      .insert(typeChanges)
      .values({ kind, payload, rationale: 'Synthetic rationale.', status })
      .returning({ id: typeChanges.id });
    return row?.id ?? '';
  };

  const payloadOf = async (id: string): Promise<unknown> => {
    const [row] = await database.db
      .select({ payload: typeChanges.payload })
      .from(typeChanges)
      .where(eq(typeChanges.id, id));
    return row?.payload;
  };

  const three = async () => ({
    target: await seedSubject(database.db, { kind: 'vehicle', name: `Target ${newId('sub')}` }),
    source: await seedSubject(database.db, { kind: 'vehicle', name: `Source ${newId('sub')}` }),
    other: await seedSubject(database.db, { kind: 'vehicle', name: `Other ${newId('sub')}` }),
  });

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('moves the labels and the identifiers of the source to the target, and deletes the source', async () => {
    const target = await seedSubject(database.db, {
      kind: 'vehicle',
      name: 'Renault Clio',
      aliases: ['Clio'],
      identifier: 'AB-123-CD',
      embedding: atSimilarity(1),
    });
    const source = await seedSubject(database.db, {
      kind: 'vehicle',
      name: 'Family car',
      aliases: ['CLIO', 'renault clio', 'The car'],
      identifier: 'VF1RFB00357123456',
      embedding: atSimilarity(0.5),
    });
    const result = await merge(source, target);
    const expected = {
      id: target,
      kind: 'vehicle',
      canonicalName: 'Renault Clio',
      private: false,
      aliases: ['Clio', 'Family car', 'The car'],
      identifiers: [
        { type: 'license_plate', value: 'AB123CD' },
        { type: 'vin', value: 'VF1RFB00357123456' },
      ],
    };
    expect(result).toEqual({ ok: true, value: expected });
    expect(await subjectRow(database.db, target)).toMatchObject({
      aliases: expected.aliases,
      identifiers: { items: expected.identifiers },
      embedding: atSimilarity(1),
    });
    expect(await subjectRow(database.db, source)).toBeUndefined();
    expect(await missingSubjectIds(database.db, [target, source])).toEqual([source]);
  });

  it('gives the target the embedding of the source when it has none', async () => {
    const target = await seedSubject(database.db, { kind: 'property', name: 'No embedding' });
    const source = await seedSubject(database.db, {
      kind: 'property',
      name: 'With embedding',
      embedding: atSimilarity(0),
    });
    await merge(source, target);
    expect((await subjectRow(database.db, target))?.embedding).toEqual(atSimilarity(0));
  });

  it('leaves no trace of the source id in any column of the database', async () => {
    const { target, source, other } = await three();
    const document = await insertSyntheticDocument(database.db, { subjectIds: [other, source] });
    const fact = await factAbout([source, other]);
    await change({ source_id: other, target_id: source });
    expect(await columnsHolding(database.db, source)).toEqual([
      'documents.subject_ids',
      'facts.subject_ids',
      'subjects.id',
      'type_changes.payload',
    ]);

    expect(await merge(source, target)).toMatchObject({ ok: true });

    expect(await columnsHolding(database.db, source)).toEqual([]);
    expect((await documentRow(database.db, document.id)).subjectIds).toEqual([other, target]);
    expect(await subjectIdsOfFact(fact)).toEqual([target, other]);
  });

  describe('each place a subject id lives', () => {
    it('rewrites the subjects of a document, in place, and names the target once', async () => {
      const { target, source, other } = await three();
      const one = await insertSyntheticDocument(database.db, { subjectIds: [other, source] });
      const both = await insertSyntheticDocument(database.db, {
        subjectIds: [source, other, target],
      });
      const untouched = await insertSyntheticDocument(database.db, { subjectIds: [other] });
      await merge(source, target);
      expect((await documentRow(database.db, one.id)).subjectIds).toEqual([other, target]);
      expect((await documentRow(database.db, both.id)).subjectIds).toEqual([target, other]);
      expect((await documentRow(database.db, untouched.id)).subjectIds).toEqual([other]);
    });

    it('rewrites the subjects of a fact, in place, and names the target once', async () => {
      const { target, source, other } = await three();
      const one = await factAbout([other, source]);
      const both = await factAbout([target, source]);
      const untouched = await factAbout([other]);
      await merge(source, target);
      expect(await subjectIdsOfFact(one)).toEqual([other, target]);
      expect(await subjectIdsOfFact(both)).toEqual([target]);
      expect(await subjectIdsOfFact(untouched)).toEqual([other]);
    });

    it('moves a pending or rejected proposal about the source onto the target', async () => {
      const { target, source, other } = await three();
      const pending = await change({ source_id: source, target_id: other });
      const rejected = await change({ source_id: other, target_id: source }, 'rejected');
      await merge(source, target);
      expect(await payloadOf(pending)).toEqual({ source_id: target, target_id: other });
      expect(await payloadOf(rejected)).toEqual({ source_id: other, target_id: target });
    });

    it('leaves the proposal of this very merge, an applied one, and one of another kind', async () => {
      const { target, source, other } = await three();
      const own = await change({ source_id: source, target_id: target });
      const applied = await change({ source_id: source, target_id: other }, 'applied');
      const entityMerge = await change(
        { source_id: source, target_id: other },
        'pending',
        'merge_entity',
      );
      await merge(source, target);
      expect(await payloadOf(own)).toEqual({ source_id: source, target_id: target });
      expect(await payloadOf(applied)).toEqual({ source_id: source, target_id: other });
      expect(await payloadOf(entityMerge)).toEqual({ source_id: source, target_id: other });
    });

    it('leaves nothing on the tombstone of a document that concerned the source', async () => {
      const { target, source } = await three();
      const document = await insertSyntheticDocument(database.db, { subjectIds: [source] });
      await factAbout([source]);
      await deleteDocument({ db: database.db }, document.id);
      await merge(source, target);
      expect(await columnsHolding(database.db, source)).toEqual([]);
    });
  });

  it('merges a source once when two merges of it run at the same time', async () => {
    const { target, source, other } = await three();
    const results = await Promise.all([merge(source, target), merge(source, other)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      error: { code: 'subject_not_found', id: source },
    });
  });

  it('refuses a merge into itself, across kinds, and of an id that is not well-formed', async () => {
    const car = await seedSubject(database.db, { kind: 'vehicle', name: 'Refused car' });
    const home = await seedSubject(database.db, { kind: 'property', name: 'Refused home' });
    expect(await merge(car, car)).toMatchObject({ ok: false, error: { code: 'self_merge' } });
    expect(await merge(car, home)).toEqual({
      ok: false,
      error: {
        code: 'kind_mismatch',
        message: 'A subject of kind "vehicle" cannot be merged into one of kind "property".',
        sourceKind: 'vehicle',
        targetKind: 'property',
      },
    });
    expect(await merge(car, newId(ID_PREFIXES.subject))).toMatchObject({
      error: { code: 'subject_not_found' },
    });
    expect(await merge("sub_' OR 1=1 --", car)).toMatchObject({
      error: { code: 'subject_not_found' },
    });
    expect(await merge(newId(ID_PREFIXES.entity), car)).toMatchObject({
      error: { code: 'subject_not_found' },
    });
    expect(await subjectRow(database.db, car)).toBeDefined();
    expect(await subjectRow(database.db, home)).toBeDefined();
  });

  it('is part of the transaction of the caller, and is undone by its rollback', async () => {
    const { target, source } = await three();
    const document = await insertSyntheticDocument(database.db, { subjectIds: [source] });
    await expect(
      database.db.transaction(async (tx) => {
        expect(
          await mergeSubjects({ db: tx }, { sourceId: source, targetId: target }),
        ).toMatchObject({ ok: true });
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(await subjectRow(database.db, source)).toBeDefined();
    expect((await documentRow(database.db, document.id)).subjectIds).toEqual([source]);
  });

  it('rolls everything back when a step fails', async () => {
    const { target, source } = await three();
    const document = await insertSyntheticDocument(database.db, { subjectIds: [source] });
    await database.db.execute(sql`
      CREATE FUNCTION refuse_subject_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'synthetic refusal'; END $$ LANGUAGE plpgsql
    `);
    await database.db.execute(sql`
      CREATE TRIGGER refuse_subject_delete BEFORE DELETE ON subjects
      FOR EACH ROW EXECUTE FUNCTION refuse_subject_delete()
    `);
    try {
      await expect(merge(source, target)).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER refuse_subject_delete ON subjects`);
    }
    expect((await documentRow(database.db, document.id)).subjectIds).toEqual([source]);
    expect((await subjectRow(database.db, target))?.aliases).toEqual([]);
  });

  describe('proposeSubjectMerge', () => {
    const propose = (sourceId: string, targetId: string, rationale?: string) =>
      proposeSubjectMerge({ db: database.db }, { sourceId, targetId, rationale });

    it('records a pending merge_subject change, automatic when a plate is shared', async () => {
      const target = await seedSubject(database.db, {
        kind: 'vehicle',
        name: 'Proposed Clio',
        identifier: 'PR-001-AA',
      });
      const source = await seedSubject(database.db, {
        kind: 'vehicle',
        name: 'Proposed car',
        identifier: 'pr 001 aa',
      });
      const result = await propose(source, target);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.created).toBe(true);
      expect(result.value.proposal).toMatchObject({
        payload: { source_id: source, target_id: target },
        rationale: '"Proposed car" and "Proposed Clio" carry the same license plate PR001AA.',
        status: 'pending',
        auto: true,
      });
      const [row] = await database.db
        .select()
        .from(typeChanges)
        .where(eq(typeChanges.id, result.value.proposal.id));
      expect(row).toMatchObject({ kind: 'merge_subject', status: 'pending', auto: true });
      expect(await subjectRow(database.db, source)).toBeDefined();
    });

    it('needs an approval for a shared label, a shared contract number or a shared address', async () => {
      const pairs = [
        [
          { kind: 'vehicle', name: 'Same label van' },
          { kind: 'vehicle', name: 'same LABEL van' },
          'go by the same label once normalized',
        ],
        [
          { kind: 'contract', name: 'Energy', identifier: 'CT-778899' },
          { kind: 'contract', name: 'Gas', identifier: 'CT-778899' },
          'share no global identifier and no normalized label',
        ],
        [
          { kind: 'property', name: 'Flat', identifier: '12 rue des Lilas, 69003 Lyon' },
          { kind: 'property', name: 'Home', identifier: '12 rue des Lilas, 69003 Lyon' },
          'share no global identifier and no normalized label',
        ],
      ] as const;
      for (const [left, right, wording] of pairs) {
        const result = await propose(
          await seedSubject(database.db, right),
          await seedSubject(database.db, left),
        );
        expect(result).toMatchObject({ ok: true, value: { proposal: { auto: false } } });
        expect(result.ok && result.value.proposal.rationale).toContain(wording);
      }
    });

    it('names an IBAN by its last characters only', async () => {
      const target = await seedSubject(database.db, {
        kind: 'account',
        name: 'Joint account',
        identifier: SYNTHETIC_IBAN,
      });
      const source = await seedSubject(database.db, {
        kind: 'account',
        name: 'Current account',
        identifier: SYNTHETIC_IBAN,
      });
      const result = await propose(source, target);
      expect(result.ok && result.value.proposal.rationale).toBe(
        '"Current account" and "Joint account" carry the same iban ****0146.',
      );
      expect(result.ok && result.value.proposal.auto).toBe(true);
    });

    it('proposes a pair once, in either direction, whatever became of the proposal', async () => {
      const { target, source } = await three();
      const first = await propose(source, target, 'A person said so.');
      const again = await propose(target, source);
      expect(first.ok && first.value.proposal.rationale).toBe('A person said so.');
      expect(again).toMatchObject({ ok: true, value: { created: false } });
      expect(again.ok && first.ok && again.value.proposal.id).toBe(
        first.ok && first.value.proposal.id,
      );
    });

    it('refuses what a merge would refuse, and records nothing', async () => {
      const car = await seedSubject(database.db, { kind: 'vehicle', name: 'Unproposed car' });
      const home = await seedSubject(database.db, { kind: 'property', name: 'Unproposed home' });
      const before = await database.db.$count(typeChanges);
      expect(await propose(car, home)).toMatchObject({ error: { code: 'kind_mismatch' } });
      expect(await propose(car, car)).toMatchObject({ error: { code: 'self_merge' } });
      expect(await database.db.$count(typeChanges)).toBe(before);
    });
  });

  describe('findSubjectMergeCandidates', () => {
    it('pairs subjects of one kind that share a global identifier or a label, the younger into the older', async () => {
      const isolated = await createTestDatabase();
      try {
        const seed = (subject: Parameters<typeof seedSubject>[1]) =>
          seedSubject(isolated.db, subject);
        const clio = await seed({ kind: 'vehicle', name: 'Clio', identifier: 'AB-123-CD' });
        const car = await seed({ kind: 'vehicle', name: 'Car', identifier: 'ab123cd' });
        const home = await seed({ kind: 'property', name: 'Lyon apartment' });
        const flat = await seed({ kind: 'property', name: 'Flat', aliases: ['LYON apartment'] });
        await seed({ kind: 'contract', name: 'Lyon apartment' });
        await seed({ kind: 'vehicle', name: 'Van', identifier: 'VA-001-AA' });
        await seed({ kind: 'vehicle', name: 'Van', identifier: 'VA-002-BB' });
        await seed({ kind: 'contract', name: 'Energy', identifier: 'CT-778899' });
        await seed({ kind: 'contract', name: 'Gas', identifier: 'CT-778899' });
        await seed({ kind: 'vehicle', name: 'n1' });
        await seed({ kind: 'vehicle', name: 'N1' });
        const candidates = await findSubjectMergeCandidates({ db: isolated.db });
        expect(candidates).toEqual([
          { sourceId: car, targetId: clio, reason: 'shared_identifier' },
          { sourceId: flat, targetId: home, reason: 'same_name' },
        ]);
        expect(await findSubjectMergeCandidates({ db: isolated.db })).toEqual(candidates);
      } finally {
        await isolated.dispose();
      }
    });
  });
});
