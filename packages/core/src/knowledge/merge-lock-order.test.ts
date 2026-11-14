import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { documents } from '../db/schema/documents.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { mergeEntities } from '../entities/merge.ts';
import { seedEntity } from '../entities/support.test-helper.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { insertSyntheticDocument, type NewDocumentRow } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { mergeSubjects } from './subject-merge.ts';
import { seedSubject } from './support.test-helper.ts';

const waitingSchema = z.tuple([z.object({ waiting: z.number() })]);

// A writer of a row over two documents (`writeIfBothLive`) locks them in the order of
// their ids. A merge rewrites every document that names the merged id: it must take
// their rows in the same order, or each waits for a row the other holds.
describe('the lock order of a merge', () => {
  let database: TestDatabase;

  const someoneWaits = async (): Promise<boolean> => {
    const [{ waiting }] = waitingSchema.parse(
      await database.db.execute(sql`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()
      `),
    );
    return waiting > 0;
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
    const holding = createGate();
    const proceed = createGate();
    const writer = database.db.transaction(async (tx) => {
      const lock = (id: string) =>
        tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.id, id))
          .for('no key update');
      await lock(first);
      holding.open();
      await proceed.opened;
      await lock(second);
    });
    await holding.opened;
    const merged = merge();
    await waitUntil(someoneWaits);
    proceed.open();
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
});
