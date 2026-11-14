import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_IDENTIFIER_KEY } from '../entities/support.test-helper.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { createPersistKnowledge } from './persist-knowledge.ts';
import {
  addDocument,
  candidate,
  documentRow,
  knowledge,
  subjectRow,
} from './support.test-helper.ts';

describe('a re-extraction that no longer names a subject', () => {
  let database: TestDatabase;
  const persist = createPersistKnowledge({ identifierKey: TEST_IDENTIFIER_KEY });

  const reextract = (documentId: string, input = knowledge()) =>
    database.db.transaction((tx) => persist(tx, { id: documentId, private: false }, input));

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('blanks the subject when no other live document concerns it', async () => {
    const document = await addDocument(
      database.db,
      { title: 'Misread bill', date: '2025-01-01' },
      knowledge({ subjects: [candidate('vehicle', 'Misread van', 'MV-001-AA')] }),
    );
    const [van = ''] = (await documentRow(database.db, document)).subjectIds;
    await reextract(document);
    expect((await documentRow(database.db, document)).subjectIds).toEqual([]);
    expect(await subjectRow(database.db, van)).toMatchObject({
      canonicalName: '',
      identifiers: { items: [] },
    });
  });

  it('keeps the subject another document still concerns', async () => {
    const van = candidate('vehicle', 'Shared van', 'SV-001-AA');
    const first = await addDocument(
      database.db,
      { title: 'First', date: '2025-01-01' },
      knowledge({ subjects: [van] }),
    );
    await addDocument(
      database.db,
      { title: 'Second', date: '2025-02-01' },
      knowledge({ subjects: [van] }),
    );
    const [shared = ''] = (await documentRow(database.db, first)).subjectIds;
    await reextract(first);
    expect((await subjectRow(database.db, shared))?.canonicalName).toBe('Shared van');
  });
});
