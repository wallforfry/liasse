import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentDates, facts, subjects } from '../db/schema/knowledge.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { mergeEntities } from '../entities/merge.ts';
import {
  atSimilarity,
  recordingEmbedder,
  seedEntity,
  SYNTHETIC_CARD,
  SYNTHETIC_IBAN,
  TEST_IDENTIFIER_KEY,
  untilSomeoneWaitsForTheEntityLock,
} from '../entities/support.test-helper.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { KnowledgeContext } from './context.ts';
import { InvalidKnowledgeError, type KnowledgeInput } from './input.ts';
import { createPersistKnowledge, persistKnowledge } from './persist-knowledge.ts';
import { prepareKnowledge, prepareWithoutModels } from './prepare-knowledge.ts';
import { withSubjectLock } from './subject-lock.ts';
import { mergeSubjects } from './subject-merge.ts';
import {
  candidate,
  datesOf,
  documentRow,
  fact,
  factsOf,
  keyDate,
  knowledge,
  seedSubject,
  subjectRow,
  TRACE,
} from './support.test-helper.ts';

const HOME_CONTRACT = knowledge({
  keyDates: [
    keyDate('effective', '2025-03-01', 'Start of cover'),
    keyDate('renewal', '2027-03-01', 'Automatic renewal'),
    keyDate('notice_deadline', '2027-02-20', 'Deadline the model guessed'),
  ],
  facts: [
    fact('The Assurances Mirabelle home insurance for the Lyon apartment renews every March 1st.', {
      validFrom: '2025-03-01',
      subjects: ['Home insurance contract', 'Lyon apartment'],
    }),
    fact('The notice period of the home insurance is two months.', {
      subjects: ['HOME INSURANCE contract'],
    }),
  ],
  subjects: [
    candidate('contract', 'Home insurance contract', 'HAB-2025-00417'),
    candidate('property', 'Lyon apartment', '12 rue des Lilas, 69003 Lyon'),
  ],
  noticePeriod: { amount: 2, unit: 'months', confidence: 0.95 },
});

describe('persistKnowledge', () => {
  let database: TestDatabase;

  const context = (overrides: Partial<KnowledgeContext> = {}): KnowledgeContext => ({
    db: database.db,
    embedder: createFakeEmbedder(),
    textModel: createFakeTextModel([]),
    identifierKey: TEST_IDENTIFIER_KEY,
    ...overrides,
  });

  const store = async (
    input: KnowledgeInput,
    document: { id: string; private?: boolean },
    overrides: Partial<KnowledgeContext> = {},
  ): Promise<void> => {
    const about = { id: document.id, private: document.private ?? false };
    const prepared = await prepareKnowledge(context(overrides), about, input);
    await database.db.transaction((tx) => persistKnowledge(tx, about, prepared));
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('stores the key dates, the facts and the subjects of a document', async () => {
    const document = await insertSyntheticDocument(database.db, { core: { language: 'en' } });
    await store(HOME_CONTRACT, document);

    expect(await datesOf(database.db, document.id)).toEqual([
      { kind: 'effective', date: '2025-03-01', label: 'Start of cover', ...quoted() },
      {
        kind: 'notice_deadline',
        date: '2027-01-01',
        label: 'Notice deadline: 2 months before Automatic renewal',
        model: null,
        quote: null,
        confidence: TRACE.confidence,
      },
      { kind: 'renewal', date: '2027-03-01', label: 'Automatic renewal', ...quoted() },
    ]);

    const { subjectIds } = await documentRow(database.db, document.id);
    expect(subjectIds).toHaveLength(2);
    const [contract, home] = await Promise.all(subjectIds.map((id) => subjectRow(database.db, id)));
    expect(contract).toMatchObject({
      kind: 'contract',
      canonicalName: 'Home insurance contract',
      identifiers: { items: [{ type: 'contract_number', value: 'HAB202500417' }] },
    });
    expect(home).toMatchObject({ kind: 'property', canonicalName: 'Lyon apartment' });
    expect(contract?.embedding).toHaveLength(384);

    const stored = await factsOf(database.db, document.id);
    expect(stored).toMatchObject([
      {
        text: HOME_CONTRACT.facts[0]?.text,
        language: 'en',
        validFrom: '2025-03-01',
        validTo: null,
        subjectIds,
        model: TRACE.model,
        schemaVersion: TRACE.schemaVersion,
        page: TRACE.page,
        quote: TRACE.quote,
      },
      { subjectIds: [subjectIds[0]], validFrom: null },
    ]);
    expect(stored.every(({ embedding }) => embedding?.length === 384)).toBe(true);
  });

  const quoted = () => ({
    model: TRACE.model,
    quote: TRACE.quote,
    confidence: TRACE.confidence,
  });

  it('replaces what a previous extraction stored, and stores the same thing twice the same', async () => {
    const document = await insertSyntheticDocument(database.db);
    const snapshot = async () => ({
      dates: await datesOf(database.db, document.id),
      facts: (await factsOf(database.db, document.id)).map(
        ({ id: _id, createdAt: _at, ...row }) => row,
      ),
      subjectIds: (await documentRow(database.db, document.id)).subjectIds,
    });
    await store(HOME_CONTRACT, document);
    const first = await snapshot();
    const subjectCount = await database.db.$count(subjects);
    await store(HOME_CONTRACT, document);
    expect(await snapshot()).toEqual(first);
    expect(await database.db.$count(subjects)).toBe(subjectCount);

    await store(
      knowledge({ facts: [fact('The contract was cancelled.')], subjects: [] }),
      document,
    );
    expect(await datesOf(database.db, document.id)).toEqual([]);
    expect((await factsOf(database.db, document.id)).map(({ text }) => text)).toEqual([
      'The contract was cancelled.',
    ]);
    expect((await documentRow(database.db, document.id)).subjectIds).toEqual([]);
  });

  it('writes nothing at all when the transaction fails', async () => {
    const document = await insertSyntheticDocument(database.db);
    await store(knowledge({ facts: [fact('The first version.')] }), document);
    const before = await database.db.$count(subjects);
    const prepared = await prepareKnowledge(
      context(),
      { id: document.id, private: false },
      knowledge({
        keyDates: [keyDate('due', '2026-10-18', 'Due')],
        facts: [fact('The second version.', { subjects: ['Rolled back car'] })],
        subjects: [candidate('vehicle', 'Rolled back car', 'RB-001-ZZ')],
      }),
    );
    await expect(
      database.db.transaction(async (tx) => {
        await persistKnowledge(tx, { id: document.id, private: false }, prepared);
        throw new Error('synthetic failure');
      }),
    ).rejects.toThrow('synthetic failure');
    expect((await factsOf(database.db, document.id)).map(({ text }) => text)).toEqual([
      'The first version.',
    ]);
    expect(await datesOf(database.db, document.id)).toEqual([]);
    expect(await database.db.$count(subjects)).toBe(before);
    expect((await documentRow(database.db, document.id)).subjectIds).toEqual([]);
  });

  it('masks an IBAN or a card number left in a fact, and keeps the fact', async () => {
    const document = await insertSyntheticDocument(database.db);
    await store(
      knowledge({
        facts: [
          fact(`Rent is debited from ${SYNTHETIC_IBAN} every month.`, {
            quote: `prélèvement sur ${SYNTHETIC_IBAN}`,
          }),
          fact(`The card ${SYNTHETIC_CARD.replace(/(.{4})/g, '$1 ').trim()} pays the gym.`),
        ],
      }),
      document,
    );
    const stored = await factsOf(database.db, document.id);
    expect(stored.map(({ text }) => text)).toEqual([
      'Rent is debited from ****0146 every month.',
      'The card ****4242 pays the gym.',
    ]);
    expect(stored[0]?.quote).toBe('prélèvement sur ****0146');
    expect(JSON.stringify(stored)).not.toContain('SYNTHETIC');
  });

  it('embeds what was masked, never the clear number', async () => {
    const document = await insertSyntheticDocument(database.db);
    const embedder = recordingEmbedder();
    await store(
      knowledge({
        facts: [fact(`Rent is debited from ${SYNTHETIC_IBAN}.`)],
        subjects: [candidate('account', `Account ${SYNTHETIC_IBAN}`)],
      }),
      document,
      { embedder },
    );
    expect(embedder.texts).toEqual(['Account ****0146', 'Rent is debited from ****0146.']);
  });

  describe('a private document', () => {
    const PRIVATE = knowledge({
      facts: [fact('The synthetic medical report mentions a knee surgery.')],
      subjects: [candidate('dependent', 'Synthetic child Ada')],
    });

    it('never reaches an embedder outside the installation: full text only', async () => {
      const document = await insertSyntheticDocument(database.db, { private: true });
      await seedSubject(database.db, {
        kind: 'dependent',
        name: 'Ada, synthetic child',
        embedding: atSimilarity(1),
      });
      const embedder = recordingEmbedder(false);
      const textModel = createFakeTextModel([]);
      await store(PRIVATE, { id: document.id, private: true }, { embedder, textModel });
      expect(embedder.texts).toEqual([]);
      expect(textModel.calls).toHaveLength(0);
      const [stored] = await factsOf(database.db, document.id);
      expect(stored).toMatchObject({ text: PRIVATE.facts[0]?.text, embedding: null });
      expect(stored?.tsv).toContain("'surgery'");
      const [subjectId = ''] = (await documentRow(database.db, document.id)).subjectIds;
      expect(await subjectRow(database.db, subjectId)).toMatchObject({
        canonicalName: 'Synthetic child Ada',
        embedding: null,
      });
    });

    it('is embedded by a local embedder', async () => {
      const document = await insertSyntheticDocument(database.db, { private: true });
      const embedder = recordingEmbedder(true);
      await store(PRIVATE, { id: document.id, private: true }, { embedder });
      expect(embedder.texts).toHaveLength(2);
      expect((await factsOf(database.db, document.id))[0]?.embedding).toEqual(atSimilarity(1));
    });

    it('drops external embeddings when the document became private during the preparation', async () => {
      const document = await insertSyntheticDocument(database.db, { private: true });
      const prepared = await prepareKnowledge(
        context({ embedder: recordingEmbedder(false) }),
        { id: document.id, private: false },
        knowledge({
          facts: [fact('A fact embedded before the flag was set.')],
          subjects: [candidate('vehicle', 'Flagged scooter')],
        }),
      );
      expect(prepared.factEmbeddings).toHaveLength(1);
      await database.db.transaction((tx) =>
        persistKnowledge(tx, { id: document.id, private: false }, prepared),
      );
      expect((await factsOf(database.db, document.id))[0]?.embedding).toBeNull();
      const [subjectId = ''] = (await documentRow(database.db, document.id)).subjectIds;
      expect((await subjectRow(database.db, subjectId))?.embedding).toBeNull();
    });
  });

  it('asks the text model before the transaction and attaches the subject it chose', async () => {
    const scooter = await seedSubject(database.db, {
      kind: 'vehicle',
      name: 'Arbitrated scooter',
      embedding: atSimilarity(0.9),
    });
    const document = await insertSyntheticDocument(database.db);
    const textModel = createFakeTextModel([{ choice: scooter }]);
    await store(
      knowledge({ subjects: [candidate('vehicle', 'Scooter of the household')] }),
      document,
      { embedder: recordingEmbedder(), textModel },
    );
    expect(textModel.calls).toHaveLength(1);
    expect((await documentRow(database.db, document.id)).subjectIds).toEqual([scooter]);
  });

  it('keeps apart two candidates of one label with two plates, and gives a fact both', async () => {
    const document = await insertSyntheticDocument(database.db);
    await store(
      knowledge({
        facts: [fact('The fleet policy covers both vans.', { subjects: ['Delivery van'] })],
        subjects: [
          candidate('vehicle', 'Delivery van', 'VA-001-AA'),
          candidate('vehicle', 'Delivery van', 'VA-002-BB'),
          candidate('vehicle', 'delivery VAN', 'va 001 aa'),
        ],
      }),
      document,
    );
    const { subjectIds } = await documentRow(database.db, document.id);
    expect(subjectIds).toHaveLength(2);
    expect((await factsOf(database.db, document.id))[0]?.subjectIds).toEqual(subjectIds);
  });

  it('creates no subject from a name a fact gives that is not a candidate', async () => {
    const document = await insertSyntheticDocument(database.db);
    const before = await database.db.$count(subjects);
    await store(
      knowledge({ facts: [fact('A fact about nothing known.', { subjects: ['Ghost subject'] })] }),
      document,
    );
    expect(await database.db.$count(subjects)).toBe(before);
    expect((await factsOf(database.db, document.id))[0]?.subjectIds).toEqual([]);
  });

  it('never writes the id of an entity that no longer exists', async () => {
    const kept = await seedEntity(database.db, { name: 'Assurances Mirabelle' });
    const target = await seedEntity(database.db, { name: 'Merge target of a fact' });
    const merged = await seedEntity(database.db, { name: 'Merged away before the write' });
    const document = await insertSyntheticDocument(database.db);
    const prepared = prepareWithoutModels(
      TEST_IDENTIFIER_KEY,
      knowledge({
        facts: [fact('A fact about three entities.', { entityIds: [kept, merged, kept] })],
      }),
    );
    await mergeEntities({ db: database.db }, { sourceId: merged, targetId: target });
    await database.db.transaction((tx) =>
      persistKnowledge(tx, { id: document.id, private: false }, prepared),
    );
    expect((await factsOf(database.db, document.id))[0]?.entityIds).toEqual([kept]);
  });

  it('gives nothing back to a tombstone', async () => {
    const document = await insertSyntheticDocument(database.db);
    await deleteDocument({ db: database.db }, document.id);
    const before = await database.db.$count(subjects);
    await store(HOME_CONTRACT, document);
    expect(await datesOf(database.db, document.id)).toEqual([]);
    expect(await factsOf(database.db, document.id)).toEqual([]);
    expect(await database.db.$count(subjects)).toBe(before);
    await store(HOME_CONTRACT, { id: newId(ID_PREFIXES.document) });
    expect(await database.db.$count(documentDates, eq(documentDates.label, 'never'))).toBe(0);
  });

  it('stores the rest of a section whose notice period is out of bounds, and says so', async () => {
    const persist = createPersistKnowledge({ identifierKey: TEST_IDENTIFIER_KEY });
    const document = await insertSyntheticDocument(database.db);
    const outcome = await database.db.transaction((tx) =>
      persist(
        tx,
        { id: document.id, private: false },
        knowledge({
          keyDates: [keyDate('renewal', '2027-03-01', 'Renewal')],
          noticePeriod: { amount: 0, unit: 'months', confidence: 1 },
        }),
      ),
    );
    expect(outcome).toEqual({ rejectedValues: 1 });
    expect((await datesOf(database.db, document.id)).map(({ kind }) => kind)).toEqual(['renewal']);
  });

  it('refuses knowledge that is not valid, before any model is called', async () => {
    const embedder = recordingEmbedder();
    const invalid = knowledge({ facts: [fact('A fact.'), fact('   ')] });
    await expect(
      prepareKnowledge(context({ embedder }), { id: 'doc_x', private: false }, invalid),
    ).rejects.toThrow(InvalidKnowledgeError);
    expect(embedder.texts).toEqual([]);
  });

  describe('in the shape the pipeline injects', () => {
    it('stores knowledge that was not prepared without any model: exact rules, full text', async () => {
      const persist = createPersistKnowledge({ identifierKey: TEST_IDENTIFIER_KEY });
      const car = await seedSubject(database.db, {
        kind: 'vehicle',
        name: 'Unprepared car',
        identifier: 'UP-777-AA',
      });
      await seedSubject(database.db, {
        kind: 'vehicle',
        name: 'Similar scooter',
        embedding: atSimilarity(1),
      });
      const document = await insertSyntheticDocument(database.db);
      await database.db.transaction((tx) =>
        persist(
          tx,
          { id: document.id, private: false },
          knowledge({
            keyDates: [keyDate('renewal', '2027-03-31', 'Renewal')],
            facts: [fact('The unprepared car is insured.', { subjects: ['Any label'] })],
            subjects: [candidate('vehicle', 'Any label', 'up 777 aa')],
            noticePeriod: { amount: 1, unit: 'months', confidence: 1 },
          }),
        ),
      );
      expect((await documentRow(database.db, document.id)).subjectIds).toEqual([car]);
      const [stored] = await factsOf(database.db, document.id);
      expect(stored).toMatchObject({ subjectIds: [car], embedding: null });
      expect(
        (await datesOf(database.db, document.id)).map(({ kind, date }) => [kind, date]),
      ).toEqual([
        ['notice_deadline', '2027-02-28'],
        ['renewal', '2027-03-31'],
      ]);
    });

    it('stores what prepareKnowledge returned as it is', async () => {
      const persist = createPersistKnowledge({ identifierKey: TEST_IDENTIFIER_KEY });
      const document = await insertSyntheticDocument(database.db);
      const about = { id: document.id, private: false };
      const prepared = await prepareKnowledge(
        context({ embedder: recordingEmbedder() }),
        about,
        knowledge({ facts: [fact('A prepared fact.')] }),
      );
      await database.db.transaction((tx) => persist(tx, about, prepared));
      expect((await factsOf(database.db, document.id))[0]?.embedding).toEqual(atSimilarity(1));
    });
  });

  // The contract of the pipeline: it takes the lock before the row of the document, and
  // writes subject ids under it. A merge then either ran before, and the candidate is
  // resolved to the target, or waits for the commit and rewrites what was written.
  it('makes a merge of subjects wait for a document written under the lock, and rewrite it', async () => {
    const target = await seedSubject(database.db, { kind: 'vehicle', name: 'Race target van' });
    const source = await seedSubject(database.db, { kind: 'vehicle', name: 'Race source van' });
    const document = await insertSyntheticDocument(database.db);
    const about = { id: document.id, private: false };
    const prepared = prepareWithoutModels(
      TEST_IDENTIFIER_KEY,
      knowledge({
        facts: [fact('The van was serviced.', { subjects: ['Race source van'] })],
        subjects: [candidate('vehicle', 'Race source van')],
      }),
    );
    // Wrapped: a promise returned as it is would be awaited before the commit it waits for.
    const written = await database.db.transaction((tx) =>
      withSubjectLock(tx, async (locked) => {
        const merge = mergeSubjects({ db: database.db }, { sourceId: source, targetId: target });
        await untilSomeoneWaitsForTheEntityLock(database.db);
        await persistKnowledge(locked, about, prepared);
        return { merge };
      }),
    );
    expect(await written.merge).toMatchObject({ ok: true });
    expect((await documentRow(database.db, document.id)).subjectIds).toEqual([target]);
    expect((await factsOf(database.db, document.id))[0]?.subjectIds).toEqual([target]);
    expect(await database.db.$count(facts, eq(facts.documentId, document.id))).toBe(1);
  });
});
