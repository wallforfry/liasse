import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentEvents } from '../db/schema/document-events.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { MAX_DOCUMENT_EVENTS, recordDocumentEvent } from './record.ts';
import { pendingStageOf } from './stage.ts';

describe('recordDocumentEvent', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const attemptsOf = async (documentId: string) =>
    (
      await database.db
        .select({ attempt: documentEvents.attempt })
        .from(documentEvents)
        .where(eq(documentEvents.documentId, documentId))
        .orderBy(asc(documentEvents.occurredAt), asc(documentEvents.id))
    ).map(({ attempt }) => attempt);

  it('keeps the most recent events of a document, and those of the others', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'received' });
    const other = await insertSyntheticDocument(database.db, { status: 'received' });
    await database.db.transaction((tx) =>
      recordDocumentEvent(tx, other.id, { stage: 'text', outcome: 'retrying', attempt: 0 }),
    );
    // One transaction each: events are ordered by the time of their transaction.
    for (let attempt = 1; attempt <= MAX_DOCUMENT_EVENTS + 2; attempt += 1) {
      await database.db.transaction((tx) =>
        recordDocumentEvent(tx, id, { stage: 'text', outcome: 'retrying', attempt }),
      );
    }
    const kept = await attemptsOf(id);
    expect(kept).toHaveLength(MAX_DOCUMENT_EVENTS);
    expect(kept[0]).toBe(3);
    expect(kept.at(-1)).toBe(MAX_DOCUMENT_EVENTS + 2);
    expect(await attemptsOf(other.id)).toEqual([0]);
  });

  it('refuses details the contract does not allow, and writes nothing', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'received' });
    await expect(
      database.db.transaction((tx) =>
        recordDocumentEvent(tx, id, {
          stage: 'text',
          outcome: 'succeeded',
          details: { rejected_values: -1 },
        }),
      ),
    ).rejects.toThrow();
    expect(await attemptsOf(id)).toEqual([]);
  });
});

describe('pendingStageOf', () => {
  it.each([
    ['received', null, 'text'],
    ['extracted', null, 'classification'],
    ['classified', null, 'extraction'],
    ['classified', 0.9, 'indexing'],
    ['indexed', 0.9, 'indexing'],
    ['needs_review', 0.2, 'indexing'],
    ['failed', null, undefined],
  ] as const)(
    'gives the stage a %s document with confidence %s waits on',
    (status, confidence, stage) => {
      expect(pendingStageOf({ status, confidence })).toBe(stage);
    },
  );
});
