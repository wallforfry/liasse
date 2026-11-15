import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { RULE_SIMILARITY } from '../entities/similarity.fixture.ts';
import { atSimilarity, TEST_IDENTIFIER_KEY } from '../entities/support.test-helper.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { getSubject } from './get-subject.ts';
import { createPersistKnowledge } from './persist-knowledge.ts';
import { resolveSubjectUnderLock } from './resolve-subject.ts';
import { withSubjectLock } from './subject-lock.ts';
import { mergeSubjects } from './subject-merge.ts';
import { prepareSubjectMentions } from './subject-mention.ts';
import {
  addDocument,
  candidate,
  documentRow,
  knowledge,
  seedSubject,
  subjectRow,
} from './support.test-helper.ts';
import { timeline } from './timeline.ts';
import { upcoming } from './upcoming.ts';

// A private document may say which subject it is about, but what it alone says of that
// subject never reaches a reader who did not ask for private documents.
describe('subjects and private documents', () => {
  let database: TestDatabase;

  const subjectsOf = async (documentId: string) =>
    (await documentRow(database.db, documentId)).subjectIds;

  const onlySubjectOf = async (documentId: string): Promise<string> => {
    const [subjectId] = await subjectsOf(documentId);
    if (subjectId === undefined) throw new Error('The document concerns no subject');
    return subjectId;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('matches a subject from a private document without giving it the address', async () => {
    const notice = await addDocument(
      database.db,
      { title: 'Public tax notice', date: '2025-01-01' },
      knowledge({ subjects: [candidate('property', 'Holiday home')] }),
    );
    const deed = await addDocument(
      database.db,
      { title: 'Private deed', date: '2025-02-01', private: true },
      knowledge({
        subjects: [candidate('property', 'Holiday home', '5 chemin des Vignes, 84000 Avignon')],
      }),
    );
    const home = await onlySubjectOf(notice);
    expect(await subjectsOf(deed)).toEqual([home]);
    expect((await subjectRow(database.db, home))?.identifiers).toEqual({ items: [] });
    const answer = await getSubject({ db: database.db }, { query: 'Holiday home' });
    expect(answer).toMatchObject({ found: true, subject: { id: home, identifiers: [] } });
    expect(
      await getSubject({ db: database.db }, { query: '5 chemin des Vignes 84000 Avignon' }),
    ).toEqual({ found: false, suggestions: [] });
  });

  it('never gives a subject an alias from a private document', async () => {
    const boat = await seedSubject(database.db, {
      kind: 'vehicle',
      name: 'Sailing boat',
      embedding: atSimilarity(0.95),
    });
    const [mention] = prepareSubjectMentions(TEST_IDENTIFIER_KEY, [
      candidate('vehicle', 'The secret yacht'),
    ]);
    if (mention === undefined) throw new Error('No mention');
    const resolution = await withSubjectLock(database.db, (tx) =>
      resolveSubjectUnderLock(
        tx,
        { mention, embedding: atSimilarity(1), verdict: undefined },
        { issuerId: undefined, private: true },
        RULE_SIMILARITY,
      ),
    );
    expect(resolution).toMatchObject({ subjectId: boat, match: 'similarity' });
    expect((await subjectRow(database.db, boat))?.aliases).toEqual([]);
  });

  it('keeps a subject a private document created private, until a public one attaches to it', async () => {
    const deed = await addDocument(
      database.db,
      { title: 'Private purchase deed', date: '2025-03-01', private: true },
      knowledge({
        subjects: [candidate('property', 'Secret cottage', '9 rue des Ormes, 21000 Dijon')],
      }),
    );
    const cottage = await onlySubjectOf(deed);
    expect((await subjectRow(database.db, cottage))?.private).toBe(true);
    const hidden = { found: false, suggestions: [] };
    expect(await getSubject({ db: database.db }, { query: 'Secret cottage' })).toEqual(hidden);
    expect(await getSubject({ db: database.db }, { id: cottage })).toEqual(hidden);
    expect(
      await getSubject({ db: database.db }, { query: 'Secret cottage', includePrivate: true }),
    ).toMatchObject({ found: true, subject: { id: cottage, name: 'Secret cottage' } });

    // A public document that designates it by its address makes it public. What it then
    // shows is only what the public document says: its label and its identifier.
    const bill = await addDocument(
      database.db,
      { title: 'Water bill', date: '2025-04-01' },
      knowledge({
        subjects: [candidate('property', 'Country house', '9, rue des Ormes 21000 DIJON')],
      }),
    );
    expect(await subjectsOf(bill)).toEqual([cottage]);
    expect(await subjectRow(database.db, cottage)).toMatchObject({
      private: false,
      canonicalName: 'Country house',
      aliases: [],
      identifiers: { items: [{ type: 'address', value: '9 rue ormes 21000 dijon' }] },
    });
    expect(await getSubject({ db: database.db }, { query: 'Secret cottage' })).toEqual(hidden);
    expect(await getSubject({ db: database.db }, { query: 'Country house' })).toMatchObject({
      found: true,
      subject: { id: cottage },
      document_count: 1,
    });
  });

  it('keeps a private subject hidden when its document is made public, until it is extracted again', async () => {
    const letter = await addDocument(
      database.db,
      { title: 'Private letter about the barn', date: '2025-05-01', private: true },
      knowledge({ subjects: [candidate('property', 'Hidden barn')] }),
    );
    const barn = await onlySubjectOf(letter);
    await database.db.update(documents).set({ private: false }).where(eq(documents.id, letter));
    const hidden = { found: false, suggestions: [] };
    expect(await getSubject({ db: database.db }, { id: barn })).toEqual(hidden);
    expect(await getSubject({ db: database.db }, { query: 'Hidden barn' })).toEqual(hidden);
    await database.db.transaction((tx) =>
      createPersistKnowledge({ identifierKey: TEST_IDENTIFIER_KEY })(
        tx,
        { id: letter, private: false },
        knowledge({ subjects: [candidate('property', 'Hidden barn')] }),
      ),
    );
    expect(await getSubject({ db: database.db }, { id: barn })).toMatchObject({
      found: true,
      subject: { name: 'Hidden barn' },
    });
  });

  it('does not let a merge carry what a private subject said onto a public one', async () => {
    const target = await seedSubject(database.db, { kind: 'vehicle', name: 'Public van' });
    const source = await seedSubject(database.db, {
      kind: 'vehicle',
      name: 'Private van',
      aliases: ['Van of the secret affair'],
      identifier: 'PV-001-AA',
      embedding: atSimilarity(0.5),
      private: true,
    });
    const merged = await mergeSubjects({ db: database.db }, { sourceId: source, targetId: target });
    expect(merged).toMatchObject({
      ok: true,
      value: { canonicalName: 'Public van', aliases: [], identifiers: [] },
    });
    // Not even the embedding of the private label: the target had none, and keeps none.
    expect(await subjectRow(database.db, target)).toMatchObject({
      private: false,
      embedding: null,
    });
  });

  it('gives a merge of a private target with a public source the names of the source only', async () => {
    const target = await seedSubject(database.db, {
      kind: 'vehicle',
      name: 'Private scooter',
      identifier: 'PS-001-AA',
      embedding: atSimilarity(0.5),
      private: true,
    });
    const source = await seedSubject(database.db, {
      kind: 'vehicle',
      name: 'Public scooter',
      identifier: 'PS-002-BB',
      embedding: atSimilarity(1),
    });
    const merged = await mergeSubjects({ db: database.db }, { sourceId: source, targetId: target });
    expect(merged).toMatchObject({
      ok: true,
      value: {
        id: target,
        canonicalName: 'Public scooter',
        aliases: [],
        identifiers: [{ type: 'license_plate', value: 'PS002BB' }],
      },
    });
    expect(await subjectRow(database.db, target)).toMatchObject({
      private: false,
      embedding: atSimilarity(1),
    });
  });

  it('keeps two private subjects private when they are merged, with all their names', async () => {
    const target = await seedSubject(database.db, {
      kind: 'dependent',
      name: 'Child A',
      private: true,
    });
    const source = await seedSubject(database.db, {
      kind: 'dependent',
      name: 'Child Ada',
      private: true,
    });
    const merged = await mergeSubjects({ db: database.db }, { sourceId: source, targetId: target });
    expect(merged).toMatchObject({ ok: true, value: { aliases: ['Child Ada'] } });
    expect((await subjectRow(database.db, target))?.private).toBe(true);
  });

  describe('once every document that concerned a subject is deleted', () => {
    it('blanks the subject, which no longer attaches anything nor shows', async () => {
      const registration = await addDocument(
        database.db,
        { title: 'Registration of the old car', date: '2024-01-01' },
        knowledge({
          keyDates: [],
          subjects: [candidate('vehicle', 'Old car', 'OC-123-AA')],
        }),
      );
      const oldCar = await onlySubjectOf(registration);
      await deleteDocument({ db: database.db }, registration);
      expect(await subjectRow(database.db, oldCar)).toMatchObject({
        canonicalName: '',
        aliases: [],
        identifiers: { items: [] },
        embedding: null,
      });
      const hidden = { found: false, suggestions: [] };
      expect(await getSubject({ db: database.db }, { id: oldCar, includePrivate: true })).toEqual(
        hidden,
      );
      expect(await getSubject({ db: database.db }, { query: 'OC-123-AA' })).toEqual(hidden);
      const again = await addDocument(
        database.db,
        { title: 'Sale of the old car', date: '2025-01-01' },
        knowledge({ subjects: [candidate('vehicle', 'Old car', 'OC-123-AA')] }),
      );
      expect(await onlySubjectOf(again)).not.toBe(oldCar);
    });

    it('keeps a subject that a live document still concerns', async () => {
      const first = await addDocument(
        database.db,
        { title: 'First bill of the flat', date: '2025-01-01' },
        knowledge({
          subjects: [candidate('property', 'Rented flat', '3 rue Pasteur, 69007 Lyon')],
        }),
      );
      const second = await addDocument(
        database.db,
        { title: 'Second bill of the flat', date: '2025-02-01' },
        knowledge({
          subjects: [candidate('property', 'Rented flat', '3 rue Pasteur, 69007 Lyon')],
        }),
      );
      const flat = await onlySubjectOf(first);
      expect(await subjectsOf(second)).toEqual([flat]);
      await deleteDocument({ db: database.db }, first);
      expect((await subjectRow(database.db, flat))?.canonicalName).toBe('Rented flat');
    });

    it('never returns a blank subject through the other readers', async () => {
      const doc = await addDocument(
        database.db,
        { title: 'Gone lease', date: '2025-01-01' },
        knowledge({ subjects: [candidate('property', 'Gone flat', '8 rue Gone, 69001 Lyon')] }),
      );
      const flat = await onlySubjectOf(doc);
      await deleteDocument({ db: database.db }, doc);
      expect(
        (await timeline({ db: database.db }, { subject: flat, includePrivate: true })).items,
      ).toEqual([]);
      expect(
        (
          await upcoming(
            { db: database.db },
            { from: '2000-01-01', to: '2100-01-01', subject: flat, includePrivate: true },
          )
        ).dates,
      ).toEqual([]);
    });
  });
});
