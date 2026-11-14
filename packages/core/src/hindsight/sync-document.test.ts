import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chunks, documentPages, documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { facts } from '../db/schema/knowledge.ts';
import { docTypes } from '../db/schema/registry.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { insertSyntheticDocument, type NewDocumentRow } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { createHindsightClient, type HindsightClientOptions } from './client.ts';
import { flagsSyntheticIdentifiers, SYNTHETIC_IDENTIFIER } from './detector.test-helper.ts';
import { HindsightError } from './errors.ts';
import { type HindsightStub, startHindsightStub, type StubOverride } from './stub.test-helper.ts';
import { type HindsightSyncDeps, syncDocumentToHindsight } from './sync-document.ts';

// Stands for everything of a document that is not a fact: none of it may be sent.
const CONTENT_MARKER = 'synthetic-content-marker';

const OUTAGE = { status: 503, body: { detail: 'synthetic outage' } } as const;

describe('syncDocumentToHindsight', () => {
  let database: TestDatabase;
  let stub: HindsightStub;
  let override: StubOverride | undefined;

  const depsFor = (
    bank = 'documents',
    options: HindsightClientOptions = {},
  ): HindsightSyncDeps => ({
    db: database.db,
    client: createHindsightClient(
      { url: stub.url, bank, apiKey: undefined },
      { retries: 0, retryDelayMs: 1, ...options },
    ),
    target: { url: stub.url, bank },
    isSensitive: flagsSyntheticIdentifiers,
  });

  const sync = (id: string, deps: HindsightSyncDeps = depsFor()) =>
    syncDocumentToHindsight(deps, id);

  const actionOf = async (id: string, deps?: HindsightSyncDeps) => (await sync(id, deps)).action;

  const insertDocument = (overrides: Partial<NewDocumentRow> = {}) =>
    insertSyntheticDocument(database.db, { status: 'indexed', ...overrides });

  const addFact = async (documentId: string, text: string, validFrom: string | null = null) => {
    await database.db.insert(facts).values({ documentId, text, validFrom });
  };

  const sentDocument = async (text = 'A fact.'): Promise<string> => {
    const { id } = await insertDocument();
    await addFact(id, text);
    await sync(id);
    return id;
  };

  const flagPrivate = async (id: string, value = true): Promise<void> => {
    await database.db.update(documents).set({ private: value }).where(eq(documents.id, id));
  };

  const documentRow = async (id: string) => {
    const [row] = await database.db.select().from(documents).where(eq(documents.id, id));
    if (row === undefined) throw new Error(`The document ${id} does not exist`);
    return row;
  };

  /** What the row says of Hindsight: whether the bank may hold facts, and the hash. */
  const recordOf = async (id: string) => {
    const { hindsightHeldSince, hindsightSentHash } = await documentRow(id);
    return { mayHold: hindsightHeldSince !== null, hashed: hindsightSentHash !== null };
  };

  const countWhere = async (condition: ReturnType<typeof sql>): Promise<number> => {
    const [row] = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM ${condition}`,
    );
    return row?.count ?? -1;
  };

  const retained = (id: string, bank = 'documents') => stub.documents.get(`${bank}/${id}`);

  beforeAll(async () => {
    database = await createTestDatabase();
    stub = await startHindsightStub({ override: (call, index) => override?.(call, index) });
  });

  afterEach(async () => {
    override = undefined;
    await database.db.delete(jobs);
    await database.db.delete(documents);
    await database.db.delete(docTypes);
  });

  afterAll(async () => {
    await stub.close();
    await database.dispose();
  });

  describe('what is sent', () => {
    it('retains the facts of a document under its id and records what it sent', async () => {
      const [type] = await database.db
        .insert(docTypes)
        .values({ slug: 'synthetic_contract', description: 'Synthetic contract' })
        .returning();
      const { id, updatedAt } = await insertDocument({
        typeId: type?.id ?? null,
        core: { document_date: '2025-02-10' },
      });
      await addFact(id, 'The synthetic contract renews every March 1st.', '2025-03-01');
      await addFact(id, 'The notice period is two months.');
      const before = stub.calls.length;

      await expect(sync(id)).resolves.toEqual({ action: 'retained', withheldFacts: 0 });
      expect(stub.calls.slice(before)).toHaveLength(1);
      expect(stub.calls.at(-1)?.body).toEqual({
        items: [
          {
            content:
              `[doc:${id}] The synthetic contract renews every March 1st. (valid_from 2025-03-01)\n` +
              `[doc:${id}] The notice period is two months.`,
            document_id: id,
            context: 'Facts extracted from a document by Liasse',
            metadata: {
              source: 'liasse',
              document_id: id,
              type: 'synthetic_contract',
              document_date: '2025-02-10',
              valid_from: '2025-03-01',
            },
            timestamp: '2025-02-10T00:00:00Z',
          },
        ],
      });
      const row = await documentRow(id);
      expect(row.hindsightSentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.hindsightHeldSince).toBeInstanceOf(Date);
      expect(row.updatedAt).toEqual(updatedAt);
    });

    it('sends the facts in the order they were extracted', async () => {
      const { id } = await insertDocument();
      await database.db.insert(facts).values([
        { documentId: id, text: 'Third.', createdAt: new Date('2026-01-03T00:00:00Z') },
        { documentId: id, text: 'First.', createdAt: new Date('2026-01-01T00:00:00Z') },
        { documentId: id, text: 'Second.', createdAt: new Date('2026-01-02T00:00:00Z') },
      ]);
      await sync(id);
      expect(retained(id)).toBe(`[doc:${id}] First.\n[doc:${id}] Second.\n[doc:${id}] Third.`);
    });

    it('sends the facts of that document only', async () => {
      const { id } = await insertDocument();
      const other = await insertDocument();
      await addFact(id, 'A fact of the document.');
      await addFact(other.id, 'A fact of another document.');
      await sync(id);
      expect(retained(id)).toBe(`[doc:${id}] A fact of the document.`);
      expect(retained(other.id)).toBeUndefined();
    });

    it('sends the facts and nothing else of the document', async () => {
      const { id } = await insertDocument({
        originalName: `${CONTENT_MARKER}.pdf`,
        hint: CONTENT_MARKER,
        title: CONTENT_MARKER,
        summary: CONTENT_MARKER,
        core: { reference: CONTENT_MARKER, document_date: CONTENT_MARKER },
        fields: { iban: CONTENT_MARKER },
        extra: { note: CONTENT_MARKER },
        provenance: { reference: { quote: CONTENT_MARKER } },
      });
      await database.db
        .insert(documentPages)
        .values({ documentId: id, page: 1, text: CONTENT_MARKER });
      await database.db
        .insert(chunks)
        .values({ documentId: id, pageFrom: 1, pageTo: 1, text: CONTENT_MARKER });
      await database.db
        .insert(facts)
        .values({ documentId: id, text: 'A synthetic fact.', quote: CONTENT_MARKER });
      const before = stub.calls.length;

      await sync(id);
      const sent = stub.calls.slice(before);
      expect(sent).toHaveLength(1);
      expect(JSON.stringify(sent)).not.toContain(CONTENT_MARKER);
      expect(retained(id)).toBe(`[doc:${id}] A synthetic fact.`);
    });

    it('leaves out a fact the detector flags, counts it, and forgets when none is left', async () => {
      const { id } = await insertDocument();
      await addFact(id, `Paid from account ${SYNTHETIC_IDENTIFIER}.`);
      await addFact(id, 'A screened fact.');
      await expect(sync(id)).resolves.toEqual({ action: 'retained', withheldFacts: 1 });
      expect(retained(id)).toBe(`[doc:${id}] A screened fact.`);
      expect(JSON.stringify(stub.calls)).not.toContain('FR76');

      await database.db.delete(facts).where(eq(facts.text, 'A screened fact.'));
      await expect(sync(id)).resolves.toEqual({ action: 'forgotten', withheldFacts: 1 });
      expect(retained(id)).toBeUndefined();
    });

    it('never sends a private document', async () => {
      const { id } = await insertDocument({ private: true });
      await addFact(id, 'A private fact.');
      const before = stub.calls.length;
      await expect(sync(id)).resolves.toEqual({ action: 'skipped', withheldFacts: 0 });
      expect(stub.calls).toHaveLength(before);
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
    });

    it('has nothing to do for a document without facts that was never sent', async () => {
      const { id } = await insertDocument();
      const before = stub.calls.length;
      expect(await actionOf(id)).toBe('skipped');
      expect(stub.calls).toHaveLength(before);
    });

    it('has nothing to do for a document Liasse does not know', async () => {
      const before = stub.calls.length;
      expect(await actionOf('doc_SYNTHETICMISSING')).toBe('skipped');
      expect(stub.calls).toHaveLength(before);
    });
  });

  describe('updates', () => {
    it('makes no request when the bank already holds these facts', async () => {
      const id = await sentDocument();
      const before = stub.calls.length;
      expect(await actionOf(id)).toBe('unchanged');
      expect(stub.calls).toHaveLength(before);
    });

    it('replaces the retained facts, under the same id, once they change', async () => {
      const id = await sentDocument('The first extraction.');
      const firstHash = (await documentRow(id)).hindsightSentHash;
      await database.db.delete(facts).where(eq(facts.documentId, id));
      await addFact(id, 'The corrected extraction.');

      expect(await actionOf(id)).toBe('retained');
      expect(retained(id)).toBe(`[doc:${id}] The corrected extraction.`);
      expect(stub.calls.at(-1)?.body).toMatchObject({ items: [{ document_id: id }] });
      const { hindsightSentHash } = await documentRow(id);
      expect(hindsightSentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(hindsightSentHash).not.toBe(firstHash);
    });

    it('retains again in the bank that is configured next', async () => {
      const id = await sentDocument('A synthetic fact.');
      expect(await actionOf(id, depsFor('other-bank'))).toBe('retained');
      expect(retained(id, 'other-bank')).toBe(`[doc:${id}] A synthetic fact.`);
    });

    it('forgets a document that became private after it was sent', async () => {
      const id = await sentDocument('A fact sent while public.');
      await flagPrivate(id);
      const { updatedAt } = await documentRow(id);

      expect(await actionOf(id)).toBe('forgotten');
      expect(retained(id)).toBeUndefined();
      expect(stub.calls.at(-1)).toMatchObject({
        method: 'DELETE',
        path: `/v1/default/banks/documents/documents/${id}`,
      });
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
      expect((await documentRow(id)).updatedAt).toEqual(updatedAt);
      const before = stub.calls.length;
      expect(await actionOf(id)).toBe('skipped');
      expect(stub.calls).toHaveLength(before);
    });

    it('retains a document again once it is public again', async () => {
      const id = await sentDocument();
      await flagPrivate(id);
      await sync(id);
      await flagPrivate(id, false);
      expect(await actionOf(id)).toBe('retained');
      expect(retained(id)).toBe(`[doc:${id}] A fact.`);
    });

    it('forgets a document whose facts are gone', async () => {
      const id = await sentDocument();
      await database.db.delete(facts).where(eq(facts.documentId, id));
      expect(await actionOf(id)).toBe('forgotten');
      expect(retained(id)).toBeUndefined();
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
    });

    it('forgets a deleted document, whose tombstone still says the bank may hold it', async () => {
      const id = await sentDocument('A fact of a document deleted later.');
      await deleteDocument({ db: database.db }, id);
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      expect(await actionOf(id)).toBe('forgotten');
      expect(retained(id)).toBeUndefined();
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
      const before = stub.calls.length;
      expect(await actionOf(id)).toBe('skipped');
      expect(stub.calls).toHaveLength(before);
    });

    it('forgets a tombstone even when a fact of it was left behind', async () => {
      const id = await sentDocument();
      await deleteDocument({ db: database.db }, id);
      await addFact(id, 'A fact written by a writer that ignored the deletion.');
      expect(await actionOf(id)).toBe('forgotten');
      expect(retained(id)).toBeUndefined();
    });

    it('makes no request for a deleted document that was never sent', async () => {
      const { id } = await insertDocument();
      await addFact(id, 'A fact never sent.');
      await deleteDocument({ db: database.db }, id);
      const before = stub.calls.length;
      expect(await actionOf(id)).toBe('skipped');
      expect(stub.calls).toHaveLength(before);
    });
  });

  describe('the record of what the bank may hold', () => {
    it('is committed before the retain is sent, without a hash', async () => {
      const id = await sentDocument('The first extraction.');
      await addFact(id, 'A second fact.');
      const seen: unknown[] = [];
      override = async () => {
        seen.push(await recordOf(id));
        return undefined;
      };
      await sync(id);
      expect(seen).toEqual([{ mayHold: true, hashed: false }]);
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: true });
    });

    it('is left as it is by a sync that fails before any request', async () => {
      const id = await sentDocument();
      const before = await documentRow(id);
      const failing: HindsightSyncDeps = {
        ...depsFor(),
        isSensitive: () => {
          throw new Error('synthetic detector failure');
        },
      };
      await expect(sync(id, failing)).rejects.toThrow('synthetic detector failure');
      const after = await documentRow(id);
      expect(after.hindsightHeldSince).toEqual(before.hindsightHeldSince);
      expect(after.hindsightSentHash).toBe(before.hindsightSentHash);
      expect(await actionOf(id)).toBe('unchanged');
    });

    it('keeps the date of the first retain', async () => {
      const id = await sentDocument();
      const { hindsightHeldSince } = await documentRow(id);
      await addFact(id, 'A second fact.');
      await sync(id);
      expect((await documentRow(id)).hindsightHeldSince).toEqual(hindsightHeldSince);
    });

    it.each([
      ['fails', OUTAGE, { statusCode: 503 }],
      [
        'is stored but answered with a body the client refuses',
        { status: 200, body: { success: false }, applied: true },
        { code: 'invalid_response' },
      ],
    ])('stays after a retain that %s, so a private flag forgets', async (_, reply, failure) => {
      const { id } = await insertDocument();
      await addFact(id, 'A fact.');
      override = () => reply;
      await expect(sync(id)).rejects.toMatchObject(failure);
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      override = undefined;
      await flagPrivate(id);
      expect(await actionOf(id)).toBe('forgotten');
      expect(stub.calls.at(-1)).toMatchObject({ method: 'DELETE' });
      expect(retained(id)).toBeUndefined();
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
    });

    it('stays after a retain the client gave up on while Hindsight stored it', async () => {
      const { id } = await insertDocument();
      await addFact(id, 'A slow fact.');
      const givenUp = createGate();
      override = async () => {
        await givenUp.opened;
        return undefined;
      };
      await expect(sync(id, depsFor('documents', { timeoutMs: 50 }))).rejects.toMatchObject({
        code: 'timeout',
      });
      givenUp.open();
      await waitUntil(() => retained(id) !== undefined);
      override = undefined;
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });

      await flagPrivate(id);
      expect(await actionOf(id)).toBe('forgotten');
      expect(retained(id)).toBeUndefined();
    });

    it('sends the facts again after a retain whose outcome is not known', async () => {
      const id = await sentDocument();
      await addFact(id, 'A second fact.');
      override = () => OUTAGE;
      await expect(sync(id)).rejects.toBeInstanceOf(HindsightError);
      await database.db.delete(facts).where(eq(facts.text, 'A second fact.'));
      override = undefined;
      // The facts are the ones of the confirmed retain again, but the failed one may
      // have replaced them in the bank.
      expect(await actionOf(id)).toBe('retained');
    });

    it('stays when the forget fails, and is cleared by the forget that succeeds', async () => {
      const id = await sentDocument();
      await flagPrivate(id);
      override = () => OUTAGE;
      await expect(sync(id)).rejects.toMatchObject({ operation: 'forget', retryable: true });
      // A failed request leaves what the bank holds unknown: no hash either.
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });
      expect(retained(id)).toBeDefined();

      override = undefined;
      expect(await actionOf(id)).toBe('forgotten');
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
    });

    it('stays on a tombstone whose forget fails', async () => {
      const id = await sentDocument();
      await deleteDocument({ db: database.db }, id);
      override = () => OUTAGE;
      await expect(sync(id)).rejects.toMatchObject({ operation: 'forget' });
      expect(await documentRow(id)).toMatchObject({ status: 'deleted' });
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });
    });

    it('is cleared when Hindsight answers that it does not hold the document', async () => {
      const id = await sentDocument();
      await flagPrivate(id);
      override = () => ({ status: 404, body: { detail: 'Document not found' } });
      expect(await actionOf(id)).toBe('forgotten');
      expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
    });

    it('stays after a 404 that is not the one of Hindsight', async () => {
      const id = await sentDocument();
      await flagPrivate(id);
      override = () => ({ status: 404, body: { detail: 'no such upstream' } });
      await expect(sync(id)).rejects.toMatchObject({ statusCode: 404, retryable: false });
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });
    });

    it('stays on a document deleted during the retain, which is then forgotten', async () => {
      const { id } = await insertDocument();
      await addFact(id, 'A fact.');
      const received = createGate();
      const proceed = createGate();
      override = async () => {
        received.open();
        await proceed.opened;
        return undefined;
      };
      const running = sync(id);
      await received.opened;
      await deleteDocument({ db: database.db }, id);
      proceed.open();
      await expect(running).resolves.toMatchObject({ action: 'retained' });
      override = undefined;
      expect(await recordOf(id)).toEqual({ mayHold: true, hashed: false });
      expect(await actionOf(id)).toBe('forgotten');
      expect(retained(id)).toBeUndefined();
    });

    it.each([
      [
        'flagged private',
        (id: string) => ({ sql: sql`UPDATE documents SET private = true WHERE id = ${id}` }),
      ],
      [
        'deleted',
        (id: string) => ({ sql: sql`UPDATE documents SET status = 'deleted' WHERE id = ${id}` }),
      ],
    ])(
      'is not written, and nothing is sent, for a document %s since it was read',
      async (_, change) => {
        const { id } = await insertDocument();
        await addFact(id, 'A fact.');
        const changed = createGate();
        const commit = createGate();
        const changing = database.db.transaction(async (tx) => {
          await tx.execute(change(id).sql);
          changed.open();
          await commit.opened;
        });
        await changed.opened;
        const before = stub.calls.length;
        // The sync reads the committed row, then its write waits for the change.
        const running = sync(id);
        await waitUntil(
          async () =>
            (await countWhere(
              sql`pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
            )) === 1,
        );
        commit.open();
        await changing;
        await expect(running).resolves.toMatchObject({ action: 'skipped' });
        expect(stub.calls).toHaveLength(before);
        expect(await recordOf(id)).toEqual({ mayHold: false, hashed: false });
      },
    );
  });
});
