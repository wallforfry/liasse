import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import * as schema from '../db/schema/index.ts';
import { jobs } from '../db/schema/jobs.ts';
import { facts } from '../db/schema/knowledge.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createGate, type Gate } from '../testing/async.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { createHindsightClient } from './client.ts';
import { flagsNothing } from './detector.test-helper.ts';
import { type SyncSession, withDocumentSyncLock } from './document-lock.ts';
import {
  HindsightError,
  HindsightRetainInFlightError,
  HindsightSyncBusyError,
  HindsightSyncLockLostError,
} from './errors.ts';
import { type HindsightStub, startHindsightStub, type StubOverride } from './stub.test-helper.ts';
import { type HindsightSyncDeps, syncDocumentToHindsight } from './sync-document.ts';
import { recordForgotten, recordRetained, recordRetainStarted } from './sync-state.ts';
import { outlastRetains } from './sync-state.test-helper.ts';

const OUTAGE = { status: 503, body: { detail: 'synthetic outage' } } as const;

describe('the Hindsight sync under concurrency', () => {
  let database: TestDatabase;
  let stub: HindsightStub;
  let override: StubOverride | undefined;

  const deps = (db = database.db): HindsightSyncDeps => ({
    db,
    client: createHindsightClient(
      { url: stub.url, bank: 'documents', apiKey: undefined },
      { retries: 0 },
    ),
    target: { url: stub.url, bank: 'documents' },
    isSensitive: flagsNothing,
  });

  const sync = (id: string) => syncDocumentToHindsight(deps(), id);

  const actionOf = async (id: string) => (await sync(id)).action;

  const documentWithFact = async (text = 'A synthetic fact.'): Promise<string> => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'indexed' });
    await database.db.insert(facts).values({ documentId: id, text });
    return id;
  };

  const replaceFacts = async (id: string, text: string): Promise<void> => {
    await database.db.delete(facts).where(eq(facts.documentId, id));
    await database.db.insert(facts).values({ documentId: id, text });
  };

  const flagPrivate = async (id: string, value = true): Promise<void> => {
    await database.db.update(documents).set({ private: value }).where(eq(documents.id, id));
  };

  const recordOf = async (id: string) => {
    const [row] = await database.db.select().from(documents).where(eq(documents.id, id));
    if (row === undefined) throw new Error(`The document ${id} does not exist`);
    return {
      mayHold: row.hindsightHeldSince !== null,
      hashed: row.hindsightSentHash !== null,
    };
  };

  const remote = (id: string) => stub.documents.get(`documents/${id}`);

  const countWhere = async (condition: ReturnType<typeof sql>): Promise<number> => {
    const [row] = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM ${condition}`,
    );
    return row?.count ?? -1;
  };

  const ADVISORY_LOCKS_HERE = sql`pg_locks WHERE locktype = 'advisory' AND granted
    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;

  // Ends the backend that holds the sync lock, as a restart or a network cut would.
  const breakLockConnection = async (): Promise<void> => {
    const ended = await database.db.execute<{ ended: boolean }>(
      sql`SELECT pg_terminate_backend(pid) AS ended FROM ${ADVISORY_LOCKS_HERE}`,
    );
    expect([...ended]).toEqual([{ ended: true }]);
  };

  /** Holds the first request of a method until `proceed` opens; Hindsight then applies it. */
  const holdFirst = (method: string): { readonly received: Gate; readonly proceed: Gate } => {
    const received = createGate();
    const proceed = createGate();
    let held = false;
    override = async (call) => {
      if (held || call.method !== method) return undefined;
      held = true;
      received.open();
      await proceed.opened;
      return undefined;
    };
    return { received, proceed };
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    stub = await startHindsightStub({ override: (call, index) => override?.(call, index) });
  });

  afterEach(async () => {
    override = undefined;
    await database.db.delete(jobs);
    await database.db.delete(documents);
  });

  afterAll(async () => {
    await stub.close();
    await database.dispose();
  });

  describe('connections', () => {
    it('holds no transaction while it waits for Hindsight', async () => {
      const id = await documentWithFact();
      const seen: number[] = [];
      override = async () => {
        seen.push(
          await countWhere(
            sql`pg_stat_activity WHERE datname = current_database()
                AND pid <> pg_backend_pid() AND xact_start IS NOT NULL`,
          ),
        );
        return undefined;
      };
      await sync(id);
      await flagPrivate(id);
      await sync(id);
      expect(seen).toEqual([0, 0]);
    });

    it('needs one connection: it runs on a pool of one', async () => {
      const client = postgres(database.url, { max: 1, onnotice: () => undefined });
      const single = drizzle(client, { schema });
      try {
        const id = await documentWithFact();
        await expect(syncDocumentToHindsight(deps(single), id)).resolves.toMatchObject({
          action: 'retained',
        });
        await flagPrivate(id);
        await expect(syncDocumentToHindsight(deps(single), id)).resolves.toMatchObject({
          action: 'forgotten',
        });
      } finally {
        await client.end();
      }
    });

    it('lets as many syncs as the pool has connections run at once', async () => {
      const ids = await Promise.all(Array.from({ length: 10 }, () => documentWithFact()));
      const results = await Promise.all(ids.map((id) => sync(id)));
      expect(results.map(({ action }) => action)).toEqual(ids.map(() => 'retained'));
    });
  });

  describe('the lock', () => {
    it('refuses a second sync of a document while one is in progress', async () => {
      const id = await documentWithFact('A fact held at Hindsight.');
      const other = await documentWithFact('A fact of another document.');
      const received = createGate();
      const proceed = createGate();
      override = async ({ body }) => {
        if (!JSON.stringify(body).includes(id)) return undefined;
        received.open();
        await proceed.opened;
        return undefined;
      };
      const held = sync(id);
      await received.opened;
      const before = stub.calls.length;
      await expect(sync(id)).rejects.toBeInstanceOf(HindsightSyncBusyError);
      expect(stub.calls).toHaveLength(before);
      expect(await actionOf(other)).toBe('retained');
      proceed.open();
      await expect(held).resolves.toMatchObject({ action: 'retained' });
      // The refused sync touched nothing: the bank is known to hold these facts.
      expect(await actionOf(id)).toBe('unchanged');
    });

    it('gives its lock back, after a success and after a failure', async () => {
      const id = await documentWithFact();
      await sync(id);
      expect(await countWhere(ADVISORY_LOCKS_HERE)).toBe(0);
      await replaceFacts(id, 'A second fact.');
      override = () => OUTAGE;
      await expect(sync(id)).rejects.toBeInstanceOf(HindsightError);
      expect(await countWhere(ADVISORY_LOCKS_HERE)).toBe(0);
      override = undefined;
      expect(await actionOf(id)).toBe('retained');
    });

    it('guards every write that rests on it', async () => {
      const id = await documentWithFact();
      const other = await documentWithFact();
      await sync(id);
      // The write runs on a connection that holds a lock, the one of another document.
      const withoutLock = async (write: (session: SyncSession) => Promise<unknown>) =>
        withDocumentSyncLock(database.db, id, (session) =>
          withDocumentSyncLock(database.db, other, (otherSession) =>
            write({ db: otherSession.db, holdsLock: session.holdsLock }),
          ),
        );
      const before = await recordOf(id);
      expect(await withoutLock((session) => recordRetainStarted(session, id, 60_000))).toBe(false);
      await withoutLock((session) => recordForgotten(session, id));
      expect(await recordOf(id)).toEqual(before);
      await withDocumentSyncLock(database.db, id, (session) => recordForgotten(session, id));
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });

      await withDocumentSyncLock(database.db, id, (session) =>
        recordRetainStarted(session, id, 60_000),
      );
      await withoutLock((session) => recordRetained(session, id, 'a'.repeat(64)));
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });
      await withDocumentSyncLock(database.db, id, (session) =>
        recordRetained(session, id, 'a'.repeat(64)),
      );
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: true });

      // A deletion that commits after the facts were read back leaves no hash either.
      await deleteDocument({ db: database.db }, id);
      await withDocumentSyncLock(database.db, id, (session) =>
        recordRetained(session, id, 'b'.repeat(64)),
      );
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });
    });
  });

  describe('a retain the lock did not cover to its end', () => {
    it.each([
      ['flagged private', (id: string) => flagPrivate(id)],
      ['deleted', (id: string) => deleteDocument({ db: database.db }, id)],
    ])('keeps the record of a document %s when a forget overtakes it', async (_, change) => {
      const id = await documentWithFact();
      const { received, proceed } = holdFirst('POST');
      const retaining = sync(id);
      await received.opened;
      await breakLockConnection();
      await change(id);
      // Hindsight does not hold the facts yet: it answers "Document not found". The
      // retain in flight may still land, so the record stays.
      await expect(sync(id)).rejects.toBeInstanceOf(HindsightRetainInFlightError);
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      proceed.open();
      await expect(retaining).rejects.toBeInstanceOf(HindsightSyncLockLostError);
      expect(remote(id)).toBeDefined();
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      await expect(sync(id)).rejects.toBeInstanceOf(HindsightRetainInFlightError);
      expect(remote(id)).toBeUndefined();
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      await outlastRetains(database.db, id);
      expect(await actionOf(id)).toBe('forgotten');
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
    });

    // The sequence of #42: the retain lands after the forget, and its sync can write
    // nothing at all afterwards, neither on its connection nor through its pool.
    it('keeps the record when the sync of the retain cannot write after it lands', async () => {
      const id = await documentWithFact();
      const client = postgres(database.url, { max: 2, onnotice: () => undefined });
      const doomed = drizzle(client, { schema });
      const { received, proceed } = holdFirst('POST');
      const retaining = syncDocumentToHindsight(deps(doomed), id);
      await received.opened;
      await breakLockConnection();
      await flagPrivate(id);
      // The forget: what it answers is the concern of the test above.
      await sync(id).catch(() => undefined);
      await client.end({ timeout: 0 });

      proceed.open();
      await expect(retaining).rejects.toThrow();
      expect(remote(id)).toBeDefined();
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      await outlastRetains(database.db, id);
      expect(await actionOf(id)).toBe('forgotten');
      expect(remote(id)).toBeUndefined();
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
    });

    it('keeps the bound of an overtaken retain through a later one that was answered', async () => {
      const id = await documentWithFact('The older fact.');
      const { received, proceed } = holdFirst('POST');
      const older = sync(id);
      await received.opened;
      await breakLockConnection();
      await replaceFacts(id, 'The newer fact.');
      expect(await actionOf(id)).toBe('retained');
      await flagPrivate(id);
      await expect(sync(id)).rejects.toBeInstanceOf(HindsightRetainInFlightError);

      proceed.open();
      await expect(older).rejects.toBeInstanceOf(HindsightSyncLockLostError);
      expect(remote(id)).toBe(`[doc:${id}] The older fact.`);
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      await outlastRetains(database.db, id);
      expect(await actionOf(id)).toBe('forgotten');
      expect(remote(id)).toBeUndefined();
    });

    it('lets a forget clear the record once a retain it overtook was answered', async () => {
      const id = await documentWithFact();
      const { received, proceed } = holdFirst('POST');
      const retaining = sync(id);
      await received.opened;
      await flagPrivate(id);
      proceed.open();
      await expect(retaining).resolves.toMatchObject({ action: 'retained' });
      expect(await actionOf(id)).toBe('forgotten');
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
    });

    it('records no hash for older facts that landed after newer ones', async () => {
      const id = await documentWithFact('The older fact.');
      const { received, proceed } = holdFirst('POST');
      const older = sync(id);
      await received.opened;
      await breakLockConnection();
      await replaceFacts(id, 'The newer fact.');
      expect(await actionOf(id)).toBe('retained');
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: true });

      proceed.open();
      await expect(older).rejects.toBeInstanceOf(HindsightSyncLockLostError);
      expect(remote(id)).toBe(`[doc:${id}] The older fact.`);
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      expect(await actionOf(id)).toBe('retained');
      expect(remote(id)).toBe(`[doc:${id}] The newer fact.`);
    });

    it('records no hash when the facts changed while it was in flight', async () => {
      const id = await documentWithFact('The first fact.');
      const { received, proceed } = holdFirst('POST');
      const retaining = sync(id);
      await received.opened;
      await replaceFacts(id, 'The corrected fact.');
      proceed.open();
      await expect(retaining).resolves.toMatchObject({ action: 'retained' });
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      expect(await actionOf(id)).toBe('retained');
      expect(remote(id)).toBe(`[doc:${id}] The corrected fact.`);
    });
  });

  describe('a forget the lock did not cover to its end', () => {
    it('leaves the facts to be retained again when it landed after they were confirmed', async () => {
      const id = await documentWithFact();
      await sync(id);
      await flagPrivate(id);
      const { received, proceed } = holdFirst('DELETE');
      const forgetting = sync(id);
      await received.opened;
      await breakLockConnection();
      await flagPrivate(id, false);
      expect(await actionOf(id)).toBe('unchanged');

      proceed.open();
      await expect(forgetting).rejects.toBeInstanceOf(HindsightSyncLockLostError);
      expect(remote(id)).toBeUndefined();
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      expect(await actionOf(id)).toBe('retained');
      expect(remote(id)).toBe(`[doc:${id}] A synthetic fact.`);
    });
  });
});
