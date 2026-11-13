import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertSyntheticDocument } from '../../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.ts';
import { documentDates, documentLinks, facts, subjects } from './knowledge.ts';

const EMBEDDING = [0.5, 0.25, 0.125];

const TRACE = {
  model: 'fake-text-model',
  schemaVersion: 3,
  page: 2,
  quote: 'renews automatically every March 1st; 2-month notice period',
  confidence: 0.75,
} as const;

describe('document_dates, document_links, subjects and facts', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase({ embeddingDim: EMBEDDING.length });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('round-trips document_dates', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    const [inserted] = await database.db
      .insert(documentDates)
      .values({
        documentId: id,
        kind: 'notice_deadline',
        date: '2027-01-01',
        label: 'Last day to give notice',
        ...TRACE,
      })
      .returning();
    const [selected] = await database.db
      .select()
      .from(documentDates)
      .where(eq(documentDates.documentId, id));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      kind: 'notice_deadline',
      date: '2027-01-01',
      label: 'Last day to give notice',
      ...TRACE,
    });
    expect(selected?.id).toMatch(/^dat_/);
  });

  it('accepts a computed date and a fact without a trace', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    const untraced = {
      model: null,
      schemaVersion: null,
      page: null,
      quote: null,
      confidence: null,
    };
    const [date] = await database.db
      .insert(documentDates)
      .values({ documentId: id, kind: 'notice_deadline', date: '2027-01-01', label: 'Computed' })
      .returning();
    const [fact] = await database.db
      .insert(facts)
      .values({ documentId: id, text: 'An untraced fact.' })
      .returning();
    expect(date).toMatchObject(untraced);
    expect(fact).toMatchObject(untraced);
  });

  it.each([{ page: 0 }, { confidence: 1.5 }, { confidence: -0.1 }])(
    'rejects the trace %j on a date and on a fact',
    async (trace) => {
      const { id } = await insertSyntheticDocument(database.db);
      await expect(
        database.db
          .insert(documentDates)
          .values({ documentId: id, kind: 'due', date: '2027-01-01', label: 'Due', ...trace }),
      ).rejects.toThrow();
      await expect(
        database.db.insert(facts).values({ documentId: id, text: 'A fact.', ...trace }),
      ).rejects.toThrow();
    },
  );

  it('round-trips document_links', async () => {
    const from = await insertSyntheticDocument(database.db);
    const to = await insertSyntheticDocument(database.db);
    const [inserted] = await database.db
      .insert(documentLinks)
      .values({ fromDocumentId: from.id, toDocumentId: to.id, kind: 'supersedes' })
      .returning();
    const [selected] = await database.db
      .select()
      .from(documentLinks)
      .where(eq(documentLinks.fromDocumentId, from.id));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({ toDocumentId: to.id, kind: 'supersedes', confidence: null });
    expect(selected?.id).toMatch(/^lnk_/);
  });

  it('rejects a self link and a duplicate link', async () => {
    const from = await insertSyntheticDocument(database.db);
    const to = await insertSyntheticDocument(database.db);
    const link = { fromDocumentId: from.id, toDocumentId: to.id, kind: 'amends' } as const;
    await database.db.insert(documentLinks).values(link);
    await expect(database.db.insert(documentLinks).values(link)).rejects.toThrow();
    await expect(
      database.db.insert(documentLinks).values({ ...link, toDocumentId: from.id }),
    ).rejects.toThrow();
  });

  it('round-trips subjects', async () => {
    const [inserted] = await database.db
      .insert(subjects)
      .values({
        kind: 'vehicle',
        canonicalName: 'Synthetic hatchback',
        aliases: ['the car'],
        identifiers: { license_plate: 'AA-000-AA' },
        embedding: EMBEDDING,
      })
      .returning();
    const [selected] = await database.db
      .select()
      .from(subjects)
      .where(eq(subjects.canonicalName, 'Synthetic hatchback'));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      kind: 'vehicle',
      aliases: ['the car'],
      identifiers: { license_plate: 'AA-000-AA' },
      embedding: EMBEDDING,
    });
    expect(selected?.id).toMatch(/^sub_/);
  });

  it('round-trips facts', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    const [inserted] = await database.db
      .insert(facts)
      .values({
        documentId: id,
        text: 'The synthetic home insurance renews every March 1st.',
        validFrom: '2025-03-01',
        entityIds: ['ent_synthetic'],
        subjectIds: ['sub_synthetic'],
        embedding: EMBEDDING,
        ...TRACE,
      })
      .returning();
    const [selected] = await database.db.select().from(facts).where(eq(facts.documentId, id));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      text: 'The synthetic home insurance renews every March 1st.',
      validFrom: '2025-03-01',
      validTo: null,
      entityIds: ['ent_synthetic'],
      subjectIds: ['sub_synthetic'],
      embedding: EMBEDDING,
      ...TRACE,
    });
    expect(selected?.id).toMatch(/^fct_/);
    expect(selected?.tsv).toContain("'insurance'");
  });

  it('rejects a fact that ends before it starts', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    await expect(
      database.db
        .insert(facts)
        .values({ documentId: id, text: 'fact', validFrom: '2026-02-01', validTo: '2026-01-01' }),
    ).rejects.toThrow();
  });
});
