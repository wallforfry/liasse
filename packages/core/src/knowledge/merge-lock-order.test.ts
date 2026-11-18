import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decideChange } from '../consolidation/apply-change.ts';
import { seedChange, seedType } from '../consolidation/consolidation.test-helper.ts';
import { documents } from '../db/schema/documents.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { mergeEntities } from '../entities/merge.ts';
import { seedEntity } from '../entities/support.test-helper.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { insertSyntheticDocument, type NewDocumentRow } from '../testing/fixtures.ts';
import { backendPid, holdsBack } from '../testing/lock-waits.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { mergeSubjects } from './subject-merge.ts';
import { seedSubject } from './support.test-helper.ts';

// A writer of a row over two documents (`writeIfBothLive`) locks them in the order of
// their ids. A merge rewrites every document that names the merged id: it must take
// their rows in the same order, or each waits for a row the other holds.
describe('the lock order of a merge', () => {
  let database: TestDatabase;

  // Holds the row of one document until `release` is called; `holder` is the server
  // process of the session that holds it.
  const holdRow = async (
    id: string,
  ): Promise<{ readonly holder: number; readonly release: () => Promise<void> }> => {
    const holding = createGate<number>();
    const release = createGate();
    const transaction = database.db.transaction(async (tx) => {
      await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, id))
        .for('no key update');
      holding.open(await backendPid(tx));
      await release.opened;
    });
    return {
      holder: await holding.opened,
      release: async () => {
        release.open();
        await transaction;
      },
    };
  };

  // Two documents whose ids sort one way and whose rows lie the other way on disk: a
  // scan meets the second id first.
  const pairAgainstTheScan = async (
    values: Partial<NewDocumentRow>,
  ): Promise<readonly [first: string, second: string]> => {
    const first = newId(ID_PREFIXES.document);
    const second = newId(ID_PREFIXES.document);
    await insertSyntheticDocument(database.db, { id: second, ...values });
    await insertSyntheticDocument(database.db, { id: first, ...values });
    return [first, second];
  };

  // Holds the first row, lets the merge start, then takes the second row, as the
  // writer of a link does.
  const raceWith = async (
    [first, second]: readonly [string, string],
    merge: () => Promise<unknown>,
  ): Promise<unknown> => {
    const holding = createGate<number>();
    const proceed = createGate();
    const writer = database.db.transaction(async (tx) => {
      const lock = (id: string) =>
        tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.id, id))
          .for('no key update');
      await lock(first);
      holding.open(await backendPid(tx));
      await proceed.opened;
      await lock(second);
    });
    const holder = await holding.opened;
    const merged = merge();
    try {
      await waitUntil(() => holdsBack(database.db, holder));
    } finally {
      proceed.open();
      await Promise.allSettled([writer, merged]);
    }
    await writer;
    return merged;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('takes the rows of the documents of a merged subject in id order', async () => {
    const target = await seedSubject(database.db, { kind: 'vehicle', name: 'Lock order target' });
    const source = await seedSubject(database.db, { kind: 'vehicle', name: 'Lock order source' });
    const pair = await pairAgainstTheScan({ subjectIds: [source] });
    const merged = await raceWith(pair, () =>
      mergeSubjects({ db: database.db }, { sourceId: source, targetId: target }),
    );
    expect(merged).toMatchObject({ ok: true });
  });

  it('takes the rows of the documents of a merged entity in id order', async () => {
    const target = await seedEntity(database.db, { name: 'Lock order target entity' });
    const source = await seedEntity(database.db, { name: 'Lock order source entity' });
    const pair = await pairAgainstTheScan({
      provenance: { issuer: { entity_id: source, match: 'name', confidence: 0.99 } },
    });
    const merged = await raceWith(pair, () =>
      mergeEntities({ db: database.db }, { sourceId: source, targetId: target }),
    );
    expect(merged).toMatchObject({ ok: true });
  });

  // A type merge rewrites the documents of the source and those that rejected it: with
  // the first id rejecting the source and the second of the source, a merge that took the
  // two sets one after the other would hold the second row and wait for the first.
  it('takes the rows of the documents of a merged type in id order, rejecters included', async () => {
    const source = await seedType(database.db, { slug: 'lock_order_source_bill' });
    const target = await seedType(database.db, { slug: 'lock_order_target_bill' });
    const other = await seedType(database.db, { slug: 'lock_order_other_bill' });
    const first = newId(ID_PREFIXES.document);
    const second = newId(ID_PREFIXES.document);
    await insertSyntheticDocument(database.db, {
      id: first,
      status: 'indexed',
      typeId: other.id,
      rejectedTypeIds: [source.id],
    });
    await insertSyntheticDocument(database.db, {
      id: second,
      status: 'indexed',
      typeId: source.id,
    });
    const change = await seedChange(database.db, 'merge', {
      source_id: source.id,
      target_id: target.id,
      field_mapping: {},
      confidence: 0.95,
    });
    const merged = await raceWith([first, second], () =>
      decideChange(database.db, change, 'apply', null),
    );
    expect(merged).toMatchObject({
      outcome: 'decided',
      decided: { change: { status: 'applied' } },
    });
  });

  // A foreign key check on a document of the source holds its row `FOR KEY SHARE`. A merge
  // that locked it `FOR UPDATE` would wait for that check, holding the rejecting document,
  // which the checking transaction then asks for. The merge rewrites no key column: it
  // locks `FOR NO KEY UPDATE`, which a key share does not hold back.
  it('takes the rows of a merged type without waiting for a key share on them', async () => {
    const source = await seedType(database.db, { slug: 'key_share_source_bill' });
    const target = await seedType(database.db, { slug: 'key_share_target_bill' });
    const other = await seedType(database.db, { slug: 'key_share_other_bill' });
    const first = newId(ID_PREFIXES.document);
    const second = newId(ID_PREFIXES.document);
    await insertSyntheticDocument(database.db, {
      id: first,
      status: 'indexed',
      typeId: other.id,
      rejectedTypeIds: [source.id],
    });
    await insertSyntheticDocument(database.db, {
      id: second,
      status: 'indexed',
      typeId: source.id,
    });
    const change = await seedChange(database.db, 'merge', {
      source_id: source.id,
      target_id: target.id,
      field_mapping: {},
      confidence: 0.95,
    });

    const holding = createGate<number>();
    const proceed = createGate();
    const checker = database.db.transaction(async (tx) => {
      await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, second))
        .for('key share');
      holding.open(await backendPid(tx));
      await proceed.opened;
      await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, first))
        .for('no key update');
    });
    const holder = await holding.opened;
    let done = false;
    const merged = decideChange(database.db, change, 'apply', null).finally(() => {
      done = true;
    });
    // Without a wait, the merge ends on its own; with one, the checker goes on.
    try {
      await waitUntil(async () => done || (await holdsBack(database.db, holder)));
    } finally {
      proceed.open();
      await Promise.allSettled([checker, merged]);
    }
    await checker;
    expect(await merged).toMatchObject({
      outcome: 'decided',
      decided: { change: { status: 'applied' } },
    });
  });

  // A type change takes every document of the type in id order (`moveDocuments`). The
  // second row is held while the merge, then the change, queue up; once it is released,
  // a merge that rewrote in scan order would hold the second row and wait for the first,
  // which the change holds while it waits for the second.
  it('takes the rows of the documents of a merged entity in the order of a type change', async () => {
    const target = await seedEntity(database.db, { name: 'Type change order target entity' });
    const source = await seedEntity(database.db, { name: 'Type change order source entity' });
    const type = await seedType(database.db, {
      slug: 'lock_order_bill',
      fields: { meter: { type: 'identifier' }, rate: { type: 'text' } },
    });
    const pair = await pairAgainstTheScan({
      status: 'indexed',
      typeId: type.id,
      schemaVersion: 1,
      fields: { meter: 'LO-1', rate: 'flat' },
      provenance: { issuer: { entity_id: source, match: 'name', confidence: 0.99 } },
    });
    const change = await seedChange(database.db, 'remove_field', {
      type_id: type.id,
      field: 'rate',
    });

    const { holder, release } = await holdRow(pair[1]);
    const merged = mergeEntities({ db: database.db }, { sourceId: source, targetId: target });
    let decided: ReturnType<typeof decideChange> | undefined;
    try {
      await waitUntil(() => holdsBack(database.db, holder));
      decided = decideChange(database.db, change, 'apply', null);
      await waitUntil(() => holdsBack(database.db, holder, 2));
    } finally {
      await release();
      await Promise.allSettled([merged, decided]);
    }

    expect(await merged).toMatchObject({ ok: true });
    expect(await decided).toMatchObject({
      outcome: 'decided',
      decided: { change: { status: 'applied' }, reextractions: 2 },
    });
  });
});
