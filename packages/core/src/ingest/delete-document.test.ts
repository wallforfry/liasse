import { createHash } from 'node:crypto';
import { eq, getTableName, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chunks, documentPages, documents, isLiveDocument } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { documentDates, documentLinks, facts } from '../db/schema/knowledge.ts';
import { docTypes } from '../db/schema/registry.ts';
import { startWorkers } from '../jobs/workers.ts';
import { storageKeyOf } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { holdsBack } from '../testing/lock-waits.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { deleteDocument, DOCUMENT_REFERENCES } from './delete-document.ts';
import { createDeleteFileHandler } from './delete-file-job.ts';
import { fileLockHolder } from './file-lock.test-helper.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const keyOf = (bytes: Uint8Array) => storageKeyOf(sha256Of(bytes));
const NEVER_ABORTED = new AbortController().signal;

describe('deleteDocument and the delete_file job', () => {
  let harness: IngestHarness;

  const ingest = (bytes: Uint8Array, filename = 'synthetic.pdf') =>
    ingestFile(harness.deps, { bytes, filename, source: 'api', hint: 'synthetic hint' });

  const documentRow = async (id: string) => {
    const [row] = await harness.database.db.select().from(documents).where(eq(documents.id, id));
    if (row === undefined) throw new Error(`The document ${id} does not exist`);
    return row;
  };

  const jobsOfKind = (kind: string) =>
    harness.database.db.select().from(jobs).where(eq(jobs.kind, kind));

  const deleteFile = (documentId: string, storage: Storage = harness.storage): Promise<void> =>
    createDeleteFileHandler({ db: harness.database.db, storage }).run(
      { documentId },
      { signal: NEVER_ABORTED, attempt: 1 },
    );

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  // Every column is given a value a tombstone must not keep, and the whole row is then
  // compared: a column added to `documents` breaks this test until `deleteDocument`
  // says what becomes of it.
  it('turns the document into a tombstone that keeps its hash and none of its content', async () => {
    const bytes = syntheticPdf('deleted');
    const { id } = await ingest(bytes, 'tax-notice.pdf');
    const [type] = await harness.database.db
      .insert(docTypes)
      .values({ slug: 'synthetic_type', description: 'Synthetic type' })
      .returning();
    await harness.database.db
      .update(documents)
      .set({
        status: 'indexed',
        state: 'superseded',
        typeId: type?.id ?? null,
        rejectedTypeIds: [type?.id ?? 'typ_synthetic'],
        schemaVersion: 3,
        title: 'Synthetic title',
        summary: 'Synthetic summary.',
        core: { reference: 'synthetic' },
        fields: { amount: 1 },
        extra: { note: 'synthetic' },
        provenance: { amount: { page: 1 } },
        error: 'synthetic error',
        confidence: 0.9,
        manualFields: ['core.reference'],
        subjectIds: ['sub_synthetic'],
        noticePeriod: { amount: 2, unit: 'months', confidence: 0.8 },
        private: true,
        watchRequeues: 1,
        fileDeletedAt: new Date('2026-01-01T00:00:00Z'),
        hindsightHeldSince: new Date('2026-02-01T00:00:00Z'),
        hindsightSentHash: 'synthetic-hash',
        hindsightRetainUntil: new Date('2026-02-01T00:06:00Z'),
      })
      .where(eq(documents.id, id));
    const before = await documentRow(id);
    expect(before).toMatchObject({ hint: 'synthetic hint', originalName: 'tax-notice.pdf' });

    expect(await deleteDocument(harness.deps, id)).toBe(true);
    const { updatedAt, ...tombstone } = await documentRow(id);
    expect(tombstone).toEqual({
      id,
      sha256: sha256Of(bytes),
      storageKey: keyOf(bytes),
      mime: 'application/pdf',
      source: 'api',
      ingestedAt: before.ingestedAt,
      status: 'deleted',
      state: 'current',
      originalName: '',
      hint: null,
      reclassificationHint: null,
      rejectedTypeIds: [],
      typeId: null,
      schemaVersion: null,
      core: {},
      fields: {},
      extra: {},
      provenance: {},
      title: null,
      summary: null,
      private: false,
      error: null,
      confidence: null,
      manualFields: [],
      subjectIds: [],
      noticePeriod: null,
      watchRequeues: 0,
      fileDeletedAt: null,
      // Kept: the only trace that Hindsight may still hold facts and owes a forget.
      hindsightHeldSince: new Date('2026-02-01T00:00:00Z'),
      hindsightSentHash: null,
      // Kept with it: a retain in flight may still land.
      hindsightRetainUntil: new Date('2026-02-01T00:06:00Z'),
    });
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it('runs the deletion hook in its transaction, on the tombstone', async () => {
    const { id } = await ingest(syntheticPdf('hooked'));
    const seen: unknown[] = [];
    const deleted = await deleteDocument(
      {
        ...harness.deps,
        onDeleted: async (tx, document) => {
          const [row] = await tx
            .select({ status: documents.status })
            .from(documents)
            .where(eq(documents.id, document.id));
          seen.push({ document, status: row?.status, queued: await jobsOfKind('delete_file') });
          await tx.insert(jobs).values({ kind: 'test_hook', payload: { documentId: document.id } });
        },
      },
      id,
    );
    expect(deleted).toBe(true);
    expect(seen).toEqual([{ document: { id }, status: 'deleted', queued: [] }]);
    expect(await jobsOfKind('test_hook')).toHaveLength(1);
    expect(await jobsOfKind('delete_file')).toHaveLength(1);
  });

  it('undoes the deletion when its hook fails, and skips the hook when nothing is deleted', async () => {
    const { id } = await ingest(syntheticPdf('hook fails'));
    let calls = 0;
    const onDeleted = () => {
      calls += 1;
      return Promise.reject(new Error('synthetic hook failure'));
    };
    await expect(deleteDocument({ ...harness.deps, onDeleted }, id)).rejects.toThrow(
      'synthetic hook failure',
    );
    expect((await documentRow(id)).status).toBe('received');
    expect(await jobsOfKind('delete_file')).toEqual([]);

    expect(await deleteDocument({ ...harness.deps, onDeleted }, 'doc_synthetic_missing')).toBe(
      false,
    );
    await deleteDocument(harness.deps, id);
    expect(await deleteDocument({ ...harness.deps, onDeleted }, id)).toBe(false);
    expect(calls).toBe(1);
  });

  it('deletes the rows derived from the document and leaves those of the others', async () => {
    const db = harness.database.db;
    const { id } = await ingest(syntheticPdf('with derived rows'));
    const other = await ingest(syntheticPdf('other document'));
    for (const documentId of [id, other.id]) {
      await db.insert(documentPages).values({ documentId, page: 1, text: 'page' });
      await db.insert(chunks).values({ documentId, pageFrom: 1, pageTo: 1, text: 'chunk' });
      await db.insert(facts).values({ documentId, text: 'fact' });
      await db
        .insert(documentDates)
        .values({ documentId, kind: 'due', date: '2026-11-30', label: 'due' });
    }
    await db.insert(documentLinks).values([
      { fromDocumentId: id, toDocumentId: other.id, kind: 'amends' },
      { fromDocumentId: other.id, toDocumentId: id, kind: 'pays' },
    ]);

    await deleteDocument(harness.deps, id);
    const remaining = async (rows: Promise<readonly { readonly documentId: string }[]>) =>
      (await rows).map(({ documentId }) => documentId);
    expect(await remaining(db.select().from(documentPages))).toEqual([other.id]);
    expect(await remaining(db.select().from(chunks))).toEqual([other.id]);
    expect(await remaining(db.select().from(facts))).toEqual([other.id]);
    expect(await remaining(db.select().from(documentDates))).toEqual([other.id]);
    expect(await db.select().from(documentLinks)).toEqual([]);
    expect(await documentRow(other.id)).toMatchObject({
      status: 'received',
      hint: 'synthetic hint',
    });
  });

  it('queues the removal of the file and cancels the processing not started yet', async () => {
    const bytes = syntheticPdf('queued removal');
    const { id } = await ingest(bytes);
    const kept = await ingest(syntheticPdf('kept'));
    await deleteDocument(harness.deps, id);
    expect(await jobsOfKind('delete_file')).toMatchObject([
      { payload: { documentId: id }, status: 'queued', maxAttempts: 8 },
    ]);
    expect(await jobsOfKind('process_document')).toMatchObject([
      { payload: { documentId: kept.id } },
    ]);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(true);
  });

  it('answers false for an unknown document and for one already deleted', async () => {
    expect(await deleteDocument(harness.deps, 'doc_synthetic_missing')).toBe(false);
    const { id } = await ingest(syntheticPdf('deleted twice'));
    expect(await deleteDocument(harness.deps, id)).toBe(true);
    expect(await deleteDocument(harness.deps, id)).toBe(false);
    expect(await jobsOfKind('delete_file')).toHaveLength(1);
  });

  it('keeps the document whole when the removal of its file cannot be queued', async () => {
    const db = harness.database.db;
    const { id } = await ingest(syntheticPdf('deletion refused'));
    await db.insert(documentPages).values({ documentId: id, page: 1, text: 'page' });
    await db.execute(
      sql`ALTER TABLE jobs ADD CONSTRAINT synthetic_refusal CHECK (kind <> 'delete_file')`,
    );
    try {
      await expect(deleteDocument(harness.deps, id)).rejects.toThrow();
    } finally {
      await db.execute(sql`ALTER TABLE jobs DROP CONSTRAINT synthetic_refusal`);
    }
    expect(await documentRow(id)).toMatchObject({ status: 'received', hint: 'synthetic hint' });
    expect(await db.select().from(documentPages)).toHaveLength(1);
    expect(await jobsOfKind('process_document')).toHaveLength(1);
  });

  it('removes the file of a tombstone, as many times as it is asked to', async () => {
    const bytes = syntheticPdf('file removed');
    const { id } = await ingest(bytes);
    await deleteDocument(harness.deps, id);
    await deleteFile(id);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(false);
    await expect(deleteFile(id)).resolves.toBeUndefined();
    await expect(deleteFile('doc_synthetic_missing')).resolves.toBeUndefined();
  });

  it('leaves the file of a document that is not deleted', async () => {
    const bytes = syntheticPdf('not deleted');
    const { id } = await ingest(bytes);
    await deleteFile(id);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(true);
  });

  it('leaves the file when the same bytes were ingested again after the deletion', async () => {
    const bytes = syntheticPdf('ingested again');
    const { id } = await ingest(bytes);
    await deleteDocument(harness.deps, id);
    expect(await ingest(bytes)).toMatchObject({ id, status: 'received', duplicate: false });
    await deleteFile(id);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(true);
  });

  it('waits for an ingestion of the same bytes that is in progress', async () => {
    const bytes = syntheticPdf('revived during the removal');
    const { id } = await ingest(bytes);
    await deleteDocument(harness.deps, id);
    const written = createGate();
    const proceed = createGate();
    const slowStorage: Storage = {
      ...harness.storage,
      put: async (key, content) => {
        await harness.storage.put(key, content);
        written.open();
        await proceed.opened;
      },
    };
    const revival = ingestFile(
      { ...harness.deps, storage: slowStorage },
      { bytes, filename: 'again.pdf', source: 'api' },
    );
    await written.opened;
    const removal = deleteFile(id);
    try {
      const ingestion = await fileLockHolder(harness.database.db, bytes);
      await waitUntil(() => holdsBack(harness.database.db, ingestion));
    } finally {
      proceed.open();
      await Promise.allSettled([revival, removal]);
    }
    await Promise.all([revival, removal]);
    expect(await documentRow(id)).toMatchObject({ status: 'received' });
    expect(await harness.storage.exists(keyOf(bytes))).toBe(true);
  });

  it('is retried by the queue until the storage accepts the removal', async () => {
    const bytes = syntheticPdf('removal retried');
    const { id } = await ingest(bytes);
    let refusals = 2;
    const flakyStorage: Storage = {
      ...harness.storage,
      delete: async (key) => {
        if (refusals > 0) {
          refusals -= 1;
          throw new Error('synthetic storage outage');
        }
        await harness.storage.delete(key);
      },
    };
    const workers = await startWorkers({
      db: harness.database.db,
      concurrency: 1,
      pollIntervalMs: 20,
      retry: { baseMs: 10, maxMs: 20 },
      handlers: () => ({
        handlers: [createDeleteFileHandler({ db: harness.database.db, storage: flakyStorage })],
      }),
    });
    try {
      await deleteDocument(harness.deps, id);
      await waitUntil(async () => !(await harness.storage.exists(keyOf(bytes))));
      await waitUntil(async () => (await jobsOfKind('delete_file'))[0]?.status === 'succeeded');
      expect(await jobsOfKind('delete_file')).toMatchObject([{ attempts: 3 }]);
    } finally {
      await workers.stop({ timeoutMs: 5000 });
    }
  });

  it('gives other modules one condition that leaves tombstones out', async () => {
    const live = await ingest(syntheticPdf('live'));
    const deleted = await ingest(syntheticPdf('tombstone'));
    await deleteDocument(harness.deps, deleted.id);
    const listed = await harness.database.db
      .select({ id: documents.id })
      .from(documents)
      .where(isLiveDocument);
    expect(listed).toEqual([{ id: live.id }]);
  });

  it('empties every table that references documents, as the catalog lists them', async () => {
    const foreignKeys = await harness.database.db.execute<{ reference: string }>(sql`
      SELECT referencing.relname || '.' || attribute.attname AS reference
      FROM pg_constraint AS key
      JOIN pg_class AS referencing ON referencing.oid = key.conrelid
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = key.conrelid AND attribute.attnum = ANY (key.conkey)
      WHERE key.contype = 'f' AND key.confrelid = 'documents'::regclass
      ORDER BY reference`);
    const covered = DOCUMENT_REFERENCES.map(
      (column) => `${getTableName(column.table)}.${column.name}`,
    );
    expect(foreignKeys.length).toBeGreaterThan(0);
    expect(foreignKeys.map(({ reference }) => reference)).toEqual([...covered].sort());
  });
});
