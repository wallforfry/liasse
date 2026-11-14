import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docTypes } from '../db/schema/registry.ts';
import { seedEntity } from '../entities/support.test-helper.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { detectLinks } from './detect-links.ts';
import { recomputeDocumentStates } from './document-state.ts';
import { getSubject } from './get-subject.ts';
import { findLinkCandidates, readLinkSource } from './link-candidates.ts';
import { replaceLinksBetween } from './link-store.ts';
import {
  addDocument,
  type AddedDocument,
  candidate,
  detectWith,
  documentRow,
  keyDate,
  knowledge,
  linkBetween,
  linksOf,
} from './support.test-helper.ts';
import { upcoming } from './upcoming.ts';

describe('links across documents and detections', () => {
  let database: TestDatabase;
  let issuer: string;

  const add = (document: Omit<AddedDocument, 'issuerId'>, input = knowledge()) =>
    addDocument(database.db, { issuerId: issuer, ...document }, input);

  const expiries = async (from: string, to: string) =>
    (await upcoming({ db: database.db }, { from, to, kinds: ['expiry', 'renewal'] })).dates.map(
      ({ date, document }) => `${date} ${document.title ?? ''}`,
    );

  const recomputeStates = (documentIds: readonly string[]) =>
    database.db.transaction((tx) => recomputeDocumentStates(tx, documentIds));

  const offeredTo = async (documentId: string): Promise<readonly string[]> => {
    const source = await readLinkSource(database.db, documentId);
    if (source === undefined) throw new Error('No source');
    return (await findLinkCandidates(database.db, source)).map(({ id }) => id);
  };

  beforeEach(async () => {
    database = await createTestDatabase();
    issuer = await seedEntity(database.db, { name: 'Synthetic Insurer' });
  });

  afterEach(async () => {
    await database.dispose();
  });

  describe('the state of an amendment', () => {
    it('follows a chain of amendments to the terminated contract', async () => {
      const contract = await add({ title: 'Contract', date: '2025-01-01' });
      const first = await add({ title: 'Amendment 1', date: '2025-03-01' });
      const second = await add(
        { title: 'Amendment 2', date: '2025-05-01' },
        knowledge({ keyDates: [keyDate('expiry', '2026-05-01', 'Option of amendment 2')] }),
      );
      const end = await add({ title: 'Termination', date: '2025-07-01' });
      await detectWith(database.db, first, [
        { candidate: contract, kind: 'amends', actor: 'document' },
      ]);
      await detectWith(database.db, second, [
        { candidate: first, kind: 'amends', actor: 'document' },
      ]);
      expect(await expiries('2026-01-01', '2026-12-31')).toEqual(['2026-05-01 Amendment 2']);
      await detectWith(database.db, end, [
        { candidate: contract, kind: 'terminates', actor: 'document' },
      ]);
      expect(await expiries('2026-01-01', '2026-12-31')).toEqual([]);
    });

    it('gives a contract subject that only a second amendment concerns the state of the contract', async () => {
      const contract = await add({ title: 'Contract', date: '2025-01-01' });
      const first = await add({ title: 'Amendment 1', date: '2025-03-01' });
      const second = await add(
        { title: 'Amendment 2', date: '2025-05-01' },
        knowledge({ subjects: [candidate('contract', 'Cellar option')] }),
      );
      await linkBetween(database.db, first, contract, 'amends');
      await linkBetween(database.db, second, first, 'amends');
      await linkBetween(
        database.db,
        await add({ title: 'End', date: '2025-07-01' }),
        contract,
        'terminates',
      );
      const [option = ''] = (await documentRow(database.db, second)).subjectIds;
      // The links were written directly: the state they give is computed here.
      await recomputeStates([contract]);
      expect(await getSubject({ db: database.db }, { id: option })).toMatchObject({
        found: true,
        state: 'terminated',
      });
    });

    it('ends on a cycle of amendments', async () => {
      const left = await add(
        { title: 'Left', date: '2025-01-01' },
        knowledge({ keyDates: [keyDate('expiry', '2026-02-01', 'Left')] }),
      );
      const right = await add(
        { title: 'Right', date: '2025-01-01' },
        knowledge({ keyDates: [keyDate('expiry', '2026-03-01', 'Right')] }),
      );
      await linkBetween(database.db, left, right, 'amends');
      await linkBetween(database.db, right, left, 'amends');
      expect(await expiries('2026-01-01', '2026-12-31')).toEqual([
        '2026-02-01 Left',
        '2026-03-01 Right',
      ]);
      const contract = await add({ title: 'Contract', date: '2024-01-01' });
      await linkBetween(database.db, right, contract, 'amends');
      await linkBetween(
        database.db,
        await add({ title: 'End', date: '2025-06-01' }),
        contract,
        'terminates',
      );
      await recomputeStates([contract]);
      expect(await expiries('2026-01-01', '2026-12-31')).toEqual([]);
    });
  });

  describe('the candidates', () => {
    it('keep the previous contract when a year of bills shares its issuer and its subject', async () => {
      const contract = candidate('contract', 'Electricity contract');
      const v1 = await add(
        { title: 'Electricity contract 2025', date: '2025-02-01' },
        knowledge({ keyDates: [keyDate('expiry', '2026-03-31', 'v1 end')], subjects: [contract] }),
      );
      for (let month = 3; month <= 14; month += 1) {
        const year = month > 12 ? 2026 : 2025;
        const mm = String(month > 12 ? month - 12 : month).padStart(2, '0');
        await add(
          { title: `Bill ${String(year)}-${mm}`, date: `${String(year)}-${mm}-05` },
          knowledge({ subjects: [contract] }),
        );
      }
      const v2 = await add(
        { title: 'Electricity contract 2026', date: '2026-01-15' },
        knowledge({ subjects: [contract] }),
      );
      expect(await offeredTo(v2)).toContain(v1);
      const offered: boolean[] = [];
      await detectLinks(
        {
          db: database.db,
          textModel: createFakeTextModel((request) => {
            offered.push(request.prompt.includes(v1));
            return {
              links: [
                {
                  candidate: v1,
                  kind: 'supersedes',
                  actor: 'document',
                  confidence: 0.9,
                  rationale: 'x',
                },
              ],
            };
          }),
        },
        v2,
      );
      expect(offered).toEqual([true]);
      expect((await documentRow(database.db, v1)).state).toBe('superseded');
    });

    it('rank documents of the type of the source first, then those with contract dates', async () => {
      const [contracts, bills] = await database.db
        .insert(docTypes)
        .values([
          { slug: 'energy_contract', description: 'An energy contract' },
          { slug: 'energy_bill', description: 'An energy bill' },
        ])
        .returning({ id: docTypes.id });
      const typed = await add({
        title: 'Typed contract, no date',
        date: '2025-01-10',
        typeId: contracts?.id,
      });
      const dated = await add(
        { title: 'Untyped letter with a renewal', date: '2025-01-11' },
        knowledge({ keyDates: [keyDate('renewal', '2026-01-11', 'Renewal')] }),
      );
      for (let day = 10; day <= 25; day += 1) {
        await add({
          title: `Bill ${String(day)}`,
          date: `2025-06-${String(day)}`,
          typeId: bills?.id,
        });
      }
      const source = await add({
        title: 'New contract',
        date: '2025-07-01',
        typeId: contracts?.id,
      });
      const offered = await offeredTo(source);
      expect(offered.slice(0, 2)).toEqual([typed, dated]);
      expect(offered).toHaveLength(12);
    });

    it('never let one type take every place', async () => {
      const [contracts] = await database.db
        .insert(docTypes)
        .values([{ slug: 'home_contract', description: 'A home contract' }])
        .returning({ id: docTypes.id });
      const letter = await add({ title: 'Old untyped letter', date: '2025-01-02' });
      for (let day = 10; day <= 25; day += 1) {
        await add({
          title: `Rider ${String(day)}`,
          date: `2025-06-${String(day)}`,
          typeId: contracts?.id,
        });
      }
      const source = await add({
        title: 'Source contract',
        date: '2025-07-01',
        typeId: contracts?.id,
      });
      expect(await offeredTo(source)).toContain(letter);
    });
  });

  describe('one superseder per document, whatever the detection', () => {
    const supersede = (from: string, to: string, confidence = 0.9) =>
      detectWith(database.db, from, [
        { candidate: to, kind: 'supersedes', actor: 'document', confidence },
      ]);

    const superseders = async (target: string) =>
      (await linksOf(database.db)).filter((line) => line.endsWith(`supersedes ${target}`));

    it('keeps the more recent superseder, in either order of detection', async () => {
      const old = await add({ title: 'Old', date: '2025-01-01' });
      const one = await add({ title: 'One', date: '2025-06-01' });
      const two = await add({ title: 'Two', date: '2025-07-01' });
      await supersede(one, old);
      await supersede(two, old);
      expect(await superseders(old)).toEqual([`${two} supersedes ${old}`]);
      await supersede(one, old);
      expect(await superseders(old)).toEqual([`${two} supersedes ${old}`]);
      expect((await documentRow(database.db, old)).state).toBe('superseded');
    });

    it('keeps the surer superseder of one day, and the first one on a tie', async () => {
      const old = await add({ title: 'Old', date: '2025-01-01' });
      const first = await add({ title: 'First', date: '2025-06-01' });
      const second = await add({ title: 'Second', date: '2025-06-01' });
      await supersede(first, old, 0.8);
      await supersede(second, old, 0.8);
      expect(await superseders(old)).toEqual([`${first} supersedes ${old}`]);
      await supersede(second, old, 0.95);
      expect(await superseders(old)).toEqual([`${second} supersedes ${old}`]);
    });

    it('keeps the first document a document supersedes', async () => {
      const older = await add({ title: 'Older', date: '2025-01-01' });
      const previous = await add({ title: 'Previous', date: '2025-02-01' });
      const latest = await add({ title: 'Latest', date: '2025-06-01' });
      await supersede(latest, previous);
      // Written for this pair alone: a detection would also replace the pair it already has.
      await replaceLinksBetween(
        database.db,
        [latest, older],
        [
          {
            fromDocumentId: latest,
            toDocumentId: older,
            kind: 'supersedes',
            confidence: 1,
            rationale: 'r',
          },
        ],
        'fake-link-model',
      );
      expect((await linksOf(database.db)).filter((line) => line.includes('supersedes'))).toEqual([
        `${latest} supersedes ${previous}`,
      ]);
      expect((await documentRow(database.db, older)).state).toBe('current');
    });
  });
});
