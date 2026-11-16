import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { ApiError } from './errors.ts';
import { reclassifyDocument } from './reclassify-document.ts';

const refusalOf = async (work: Promise<unknown>): Promise<ApiError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
};

describe('reclassifyDocument', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('queues the reclassification of a settled document with the options given', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'needs_review' });
    await reclassifyDocument(database, id, { hint: 'a payslip', new_type: true });
    const queued = await database.db.select().from(jobs);
    expect(queued.map(({ kind, payload }) => ({ kind, payload }))).toContainEqual({
      kind: 'reclassify_document',
      payload: { documentId: id, rejectedTypeId: null, hint: 'a payslip', newType: true },
    });
  });

  it('refuses a document that is not settled, and one no document has', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'classified' });
    expect(await refusalOf(reclassifyDocument(database, id))).toMatchObject({
      kind: 'invalid',
      code: 'document_not_settled',
    });
    expect(
      await refusalOf(reclassifyDocument(database, 'doc_01JC0000000000000000000000')),
    ).toMatchObject({ kind: 'not_found', code: 'document_not_found' });
  });
});
