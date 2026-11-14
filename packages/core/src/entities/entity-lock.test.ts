import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { withEntityLock } from './entity-lock.ts';
import { missingEntityIds } from './entity-store.ts';
import { mergeEntities } from './merge.ts';
import { seedEntity, untilSomeoneWaitsForTheEntityLock } from './support.test-helper.ts';

describe('the entity lock', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('tells which entities no longer exist', async () => {
    const kept = await seedEntity(database.db, { name: 'Kept' });
    const target = await seedEntity(database.db, { name: 'Merge target' });
    const merged = await seedEntity(database.db, { name: 'Merged away' });
    const unknown = newId(ID_PREFIXES.entity);
    await mergeEntities({ db: database.db }, { sourceId: merged, targetId: target });
    expect(await missingEntityIds(database.db, [kept, merged, target, unknown])).toEqual([
      merged,
      unknown,
    ]);
    expect(await missingEntityIds(database.db, [kept])).toEqual([]);
    expect(await missingEntityIds(database.db, [])).toEqual([]);
  });

  // The contract of the pipeline: it writes the entity ids of a document under the lock,
  // after checking they still exist. A merge then either ran before, and the check sees
  // it, or runs after the commit, and rewrites what was written.
  it('makes a merge wait for a document written under the lock, and rewrite it', async () => {
    const target = await seedEntity(database.db, { name: 'Race target' });
    const source = await seedEntity(database.db, { name: 'Race source' });
    const document = await insertSyntheticDocument(database.db);
    const written = await database.db.transaction(async (tx) =>
      withEntityLock(tx, async (locked) => {
        expect(await missingEntityIds(locked, [source])).toEqual([]);
        const merge = mergeEntities({ db: database.db }, { sourceId: source, targetId: target });
        await untilSomeoneWaitsForTheEntityLock(database.db);
        await locked
          .update(documents)
          .set({ provenance: { issuer: { entity_id: source } } })
          .where(eq(documents.id, document.id));
        return { merge, id: document.id };
      }),
    );
    expect(await written.merge).toMatchObject({ ok: true });
    const [row] = await database.db
      .select({ provenance: documents.provenance })
      .from(documents)
      .where(eq(documents.id, written.id));
    expect(row?.provenance).toEqual({ issuer: { entity_id: target } });
  });

  it('runs the work in a transaction of its own when given a database', async () => {
    await expect(
      withEntityLock(database.db, async (tx) => {
        await insertSyntheticDocument(database.db, { sha256: 'outside-the-lock' });
        await tx
          .update(documents)
          .set({ title: 'Written under the lock' })
          .where(eq(documents.sha256, 'outside-the-lock'));
        throw new Error('synthetic failure');
      }),
    ).rejects.toThrow('synthetic failure');
    const [row] = await database.db
      .select({ title: documents.title })
      .from(documents)
      .where(eq(documents.sha256, 'outside-the-lock'));
    expect(row).toEqual({ title: null });
  });

  it('undoes only its own work when it fails inside a transaction of the caller', async () => {
    const document = await insertSyntheticDocument(database.db);
    await database.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ title: 'By the caller' })
        .where(eq(documents.id, document.id));
      await expect(
        withEntityLock(tx, async (locked) => {
          await locked
            .update(documents)
            .set({ summary: 'Under the lock' })
            .where(eq(documents.id, document.id));
          throw new Error('synthetic failure');
        }),
      ).rejects.toThrow('synthetic failure');
    });
    const [row] = await database.db
      .select({ title: documents.title, summary: documents.summary })
      .from(documents)
      .where(eq(documents.id, document.id));
    expect(row).toEqual({ title: 'By the caller', summary: null });
  });
});
