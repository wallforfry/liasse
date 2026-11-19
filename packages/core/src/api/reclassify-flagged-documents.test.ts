import type { ClassificationOutcome, DocumentStatus } from '@liasse/contract/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { MANUAL_PROVENANCE, PIPELINE_PROVENANCE_KEY } from '../domain/provenance.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { reclassifyDocumentJob } from '../pipeline/jobs.ts';
import { requestReclassification } from '../pipeline/request-reclassification.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { reclassifyFlaggedDocuments } from './reclassify-flagged-documents.ts';

const classifiedAs = (outcome: ClassificationOutcome) => ({
  [PIPELINE_PROVENANCE_KEY]: {
    type: { model: 'synthetic-model', confidence: 0, outcome, refusal: 'quota_exceeded' },
  },
});

describe('reclassifyFlaggedDocuments', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.dispose();
  });

  const insert = async (
    outcome: ClassificationOutcome,
    status: DocumentStatus = 'needs_review',
    privateDocument = false,
  ): Promise<string> =>
    (
      await insertSyntheticDocument(database.db, {
        status,
        provenance: classifiedAs(outcome),
        private: privateDocument,
      })
    ).id;

  const queuedDocuments = async (): Promise<readonly unknown[]> =>
    (await database.db.select().from(jobs))
      .filter(({ kind }) => kind === reclassifyDocumentJob.name)
      .map(({ payload }) => payload)
      .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  it('queues the documents flagged with the reason, private ones included, and no other', async () => {
    const untyped = await insert('untyped');
    const privateUntyped = await insert('untyped', 'needs_review', true);
    await insert('fallback');
    await insert('untyped', 'classified');
    await insertSyntheticDocument(database.db, {
      status: 'needs_review',
      provenance: { [PIPELINE_PROVENANCE_KEY]: { type: MANUAL_PROVENANCE } },
    });

    expect(await reclassifyFlaggedDocuments(database, { reason: 'type_untyped' })).toEqual({
      queued: 2,
      skipped: 0,
      remaining: 0,
    });
    expect(await queuedDocuments()).toEqual(
      [untyped, privateUntyped]
        .map((documentId) => ({ documentId, rejectedTypeId: null, newType: false }))
        .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  });

  it('skips and counts a document with a job pending, which a second request skips too', async () => {
    const busy = await insert('untyped');
    await enqueue(database.db, {
      kind: reclassifyDocumentJob,
      payload: { documentId: busy, rejectedTypeId: null, newType: false },
    });
    await insert('untyped');

    expect(await reclassifyFlaggedDocuments(database, { reason: 'type_untyped' })).toEqual({
      queued: 1,
      skipped: 1,
      remaining: 0,
    });
    expect(await reclassifyFlaggedDocuments(database, { reason: 'type_untyped' })).toEqual({
      queued: 0,
      skipped: 2,
      remaining: 0,
    });
    expect(await queuedDocuments()).toHaveLength(2);
  });

  it('queues the oldest documents up to the limit, and counts the rest for the next request', async () => {
    const ids = [await insert('fallback'), await insert('fallback'), await insert('fallback')];
    const [first, second, third] = ids.toSorted();

    expect(
      await reclassifyFlaggedDocuments(database, { reason: 'type_fallback', limit: 2 }),
    ).toEqual({ queued: 2, skipped: 0, remaining: 1 });
    expect(await queuedDocuments()).toEqual(
      [first, second].map((documentId) => ({ documentId, rejectedTypeId: null, newType: false })),
    );
    expect(
      await reclassifyFlaggedDocuments(database, { reason: 'type_fallback', limit: 2 }),
    ).toEqual({ queued: 1, skipped: 2, remaining: 0 });
    expect(await queuedDocuments()).toContainEqual({
      documentId: third,
      rejectedTypeId: null,
      newType: false,
    });
  });

  it('refuses a limit beyond the bound', async () => {
    await expect(
      reclassifyFlaggedDocuments(database, { reason: 'type_untyped', limit: 101 }),
    ).rejects.toThrow();
  });

  it('leaves alone a document that no longer has the reason once its row is locked', async () => {
    const id = await insert('untyped');
    expect(await requestReclassification(database.db, id, { onlyIf: () => false })).toBe(
      'not_settled',
    );
    expect(await queuedDocuments()).toEqual([]);
  });
});
