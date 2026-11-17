import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { ApiError } from './errors.ts';
import { reextractDocument } from './reextract-document.ts';
import { retryDocument } from './retry-document.ts';

const refusalOf = async (work: Promise<unknown>): Promise<ApiError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
};

describe('reextractDocument', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const jobsOf = async (documentId: string) =>
    (await database.db.select().from(jobs))
      .filter(({ payload }) => payload.documentId === documentId)
      .map(({ kind, payload }) => ({ kind, payload }));

  it.each(['indexed', 'needs_review'] as const)(
    'queues the re-extraction of an %s document, and refuses a second one while it waits',
    async (status) => {
      const { id } = await insertSyntheticDocument(database.db, { status });
      await reextractDocument(database, id);
      expect(await jobsOf(id)).toEqual([
        { kind: 'reextract_document', payload: { documentId: id } },
      ]);
      expect(await refusalOf(reextractDocument(database, id))).toMatchObject({
        kind: 'invalid',
        code: 'document_not_settled',
      });
    },
  );

  it.each(['received', 'classified', 'failed'] as const)(
    'refuses a document that is %s',
    async (status) => {
      const { id } = await insertSyntheticDocument(database.db, { status });
      expect(await refusalOf(reextractDocument(database, id))).toMatchObject({
        kind: 'invalid',
        code: 'document_not_settled',
      });
      expect(await jobsOf(id)).toEqual([]);
    },
  );

  it('refuses a settled document while its reclassification is pending', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'indexed' });
    await database.db.insert(jobs).values({
      kind: 'reclassify_document',
      payload: { documentId: id, rejectedTypeId: null, newType: false },
    });
    expect(await refusalOf(reextractDocument(database, id))).toMatchObject({
      code: 'document_not_settled',
    });
  });

  it('answers document_not_found for an unknown or deleted document', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'deleted' });
    for (const missing of [id, 'doc_01JC0000000000000000000000']) {
      expect(await refusalOf(reextractDocument(database, missing))).toMatchObject({
        kind: 'not_found',
        code: 'document_not_found',
      });
    }
  });

  // The split of roles: a settled document is extracted again, never processed again.
  it('leaves retryDocument refusing a settled document', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'indexed' });
    expect(await refusalOf(retryDocument(database, id))).toMatchObject({
      kind: 'invalid',
      code: 'document_not_failed',
    });
    expect(await jobsOf(id)).toEqual([]);
  });
});
