import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { listSubjects, listSubjectsOutputSchema } from './list-subjects.ts';
import { buildScenario, type Scenario } from './scenario.test-helper.ts';

describe('listSubjects, on a synthetic household', () => {
  let database: TestDatabase;
  let scenario: Scenario;

  beforeAll(async () => {
    database = await createTestDatabase();
    scenario = await buildScenario(database.db);
  });

  afterAll(async () => {
    await database.dispose();
  });

  const list = (input: Parameters<typeof listSubjects>[1] = {}) =>
    listSubjects({ db: database.db }, input);

  const summary = async (input: Parameters<typeof listSubjects>[1] = {}) =>
    (await list(input)).subjects.map(({ id, documentCount }) => [id, documentCount]);

  it('lists the subjects public documents concern, oldest first, with their counts', async () => {
    const result = await list();
    expect(listSubjectsOutputSchema.parse(result)).toEqual(result);
    expect(result.truncated).toBe(false);
    const { oldContractSubject, home, newContractSubject, car } = scenario.subjects;
    expect(result.subjects.map(({ id, documentCount }) => [id, documentCount])).toEqual([
      [oldContractSubject, 3],
      [home, 4],
      [newContractSubject, 1],
      [car, 2],
    ]);
    expect(result.subjects.find(({ id }) => id === car)).toMatchObject({
      kind: 'vehicle',
      name: 'Renault Clio',
    });
  });

  it('shows what private documents add only when asked', async () => {
    const { car, privateAccount } = scenario.subjects;
    expect(await summary()).not.toContainEqual([privateAccount, 1]);
    const everything = await summary({ includePrivate: true });
    expect(everything).toContainEqual([car, 3]);
    expect(everything).toContainEqual([privateAccount, 1]);
  });

  it('filters by kind, and by a query read as get_subject reads it', async () => {
    const { oldContractSubject, newContractSubject, car } = scenario.subjects;
    expect(await summary({ kind: 'contract' })).toEqual([
      [oldContractSubject, 3],
      [newContractSubject, 1],
    ]);
    expect(await summary({ query: 'home insurance contract' })).toEqual([
      [oldContractSubject, 3],
      [newContractSubject, 1],
    ]);
    expect(await summary({ query: 'AB-123-CD' })).toEqual([[car, 2]]);
    expect(await summary({ query: 'Private loan account' })).toEqual([]);
  });

  // A document made public keeps the private subject it created until it is extracted
  // again: a public document then concerns a subject that is still private.
  it('never shows a private subject without being asked, even when a public document concerns it', async () => {
    const { privateLetter } = scenario.documents;
    const { privateAccount } = scenario.subjects;
    const flag = (value: boolean) =>
      database.db.update(documents).set({ private: value }).where(eq(documents.id, privateLetter));
    await flag(false);
    try {
      expect((await summary()).map(([id]) => id)).not.toContain(privateAccount);
      expect(await summary({ includePrivate: true })).toContainEqual([privateAccount, 1]);
    } finally {
      await flag(true);
    }
  });

  it('says when the limit cut the list', async () => {
    const result = await list({ limit: 2 });
    expect(result.subjects).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});
