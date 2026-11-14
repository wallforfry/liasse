import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertSyntheticDocument } from '../../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.ts';
import { chunks, documentPages, documents } from './documents.ts';
import { facts } from './knowledge.ts';
import { docTypes } from './registry.ts';

const EMBEDDING = [0.5, 0.25, 0.125];

describe('documents, document_pages and chunks', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase({ embeddingDim: EMBEDDING.length });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('round-trips documents', async () => {
    const [type] = await database.db
      .insert(docTypes)
      .values({ slug: 'payslip', description: 'Monthly payslip' })
      .returning();
    const [inserted] = await database.db
      .insert(documents)
      .values({
        sha256: 'synthetic-sha256-full',
        storageKey: 'synthetic/full',
        mime: 'application/pdf',
        originalName: 'payslip.pdf',
        source: 'watch',
        status: 'needs_review',
        state: 'superseded',
        typeId: type?.id,
        schemaVersion: 3,
        core: { amount: { value: 84.2, currency: 'EUR' } },
        fields: { net_pay: 1800 },
        extra: { note: 'synthetic' },
        provenance: { amount: { model: 'fake-text-model', confidence: 0.94, page: 1 } },
        title: 'Payslip',
        summary: 'A synthetic payslip.',
        private: true,
        error: 'low confidence',
        confidence: 0.5,
        manualFields: ['core.amount'],
        subjectIds: ['sub_synthetic'],
      })
      .returning();
    const [selected] = await database.db
      .select()
      .from(documents)
      .where(eq(documents.sha256, 'synthetic-sha256-full'));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      source: 'watch',
      status: 'needs_review',
      state: 'superseded',
      typeId: type?.id,
      schemaVersion: 3,
      core: { amount: { value: 84.2, currency: 'EUR' } },
      fields: { net_pay: 1800 },
      extra: { note: 'synthetic' },
      provenance: { amount: { model: 'fake-text-model', confidence: 0.94, page: 1 } },
      private: true,
      error: 'low confidence',
      confidence: 0.5,
      manualFields: ['core.amount'],
      subjectIds: ['sub_synthetic'],
    });
    expect(selected?.id).toMatch(/^doc_/);
    expect(selected?.ingestedAt).toBeInstanceOf(Date);
    expect(selected?.updatedAt).toBeInstanceOf(Date);
  });

  it('defaults a new document to received, current and empty fields', async () => {
    expect(await insertSyntheticDocument(database.db)).toMatchObject({
      status: 'received',
      state: 'current',
      typeId: null,
      core: {},
      fields: {},
      extra: {},
      provenance: {},
      private: false,
      error: null,
      confidence: null,
      manualFields: [],
      subjectIds: [],
    });
  });

  it('rejects a second document with the same sha256', async () => {
    const { sha256 } = await insertSyntheticDocument(database.db);
    await expect(insertSyntheticDocument(database.db, { sha256 })).rejects.toThrow();
  });

  it('rejects a confidence outside 0..1', async () => {
    await expect(insertSyntheticDocument(database.db, { confidence: 1.5 })).rejects.toThrow();
  });

  it('round-trips document_pages and derives the search vector', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    await database.db
      .insert(documentPages)
      .values({ documentId: id, page: 1, text: 'Relevé d’électricité' });
    expect(
      await database.db.select().from(documentPages).where(eq(documentPages.documentId, id)),
    ).toEqual([
      {
        documentId: id,
        page: 1,
        language: null,
        text: 'Relevé d’électricité',
        tsv: "'d':2 'electricite':3 'releve':1",
      },
    ]);
  });

  it('round-trips chunks', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    const [inserted] = await database.db
      .insert(chunks)
      .values({ documentId: id, pageFrom: 1, pageTo: 2, text: 'Total due', embedding: EMBEDDING })
      .returning();
    const [selected] = await database.db.select().from(chunks).where(eq(chunks.documentId, id));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      pageFrom: 1,
      pageTo: 2,
      text: 'Total due',
      embedding: EMBEDDING,
      tsv: "'due':2 'total':1",
    });
    expect(selected?.id).toMatch(/^chk_/);
  });

  it('orders chunks by cosine distance', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    await database.db.insert(chunks).values([
      { documentId: id, pageFrom: 1, pageTo: 1, text: 'far', embedding: [0, 0, 1] },
      { documentId: id, pageFrom: 1, pageTo: 1, text: 'near', embedding: [1, 0.1, 0] },
    ]);
    const nearest = await database.db
      .select({ text: chunks.text })
      .from(chunks)
      .where(eq(chunks.documentId, id))
      .orderBy(sql`${chunks.embedding} <=> '[1,0,0]'`);
    expect(nearest.map((row) => row.text)).toEqual(['near', 'far']);
  });

  it('deletes the derived rows of a deleted document', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    await database.db.insert(documentPages).values({ documentId: id, page: 1, text: 'page' });
    await database.db.insert(chunks).values({ documentId: id, pageFrom: 1, pageTo: 1, text: 'c' });
    await database.db.insert(facts).values({ documentId: id, text: 'fact' });
    await database.db.delete(documents).where(eq(documents.id, id));
    expect(
      await database.db.select().from(documentPages).where(eq(documentPages.documentId, id)),
    ).toEqual([]);
    expect(await database.db.select().from(chunks).where(eq(chunks.documentId, id))).toEqual([]);
    expect(await database.db.select().from(facts).where(eq(facts.documentId, id))).toEqual([]);
  });
});
