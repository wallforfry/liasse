// The sequences of the review of the first version of this integration (W1 to W5),
// through the ingestion, the deletion hook and the handlers, as the server wires them.
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { findSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import { jobs } from '../db/schema/jobs.ts';
import { facts } from '../db/schema/knowledge.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createIngestHarness, type IngestHarness } from '../ingest/harness.test-helper.ts';
import { ingestFile } from '../ingest/ingest-file.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import type { HindsightClientOptions } from './client.ts';
import { flagsSyntheticIdentifiers, SYNTHETIC_IDENTIFIER } from './detector.test-helper.ts';
import { createHindsightIntegration } from './integration.ts';
import { type HindsightStub, startHindsightStub, type StubOverride } from './stub.test-helper.ts';

const NEVER_ABORTED = new AbortController().signal;

describe('the Hindsight sync over the life of a document', () => {
  let harness: IngestHarness;
  let stub: HindsightStub;
  let override: StubOverride | undefined;

  const integration = (client: HindsightClientOptions = {}) =>
    createHindsightIntegration(
      { url: stub.url, bank: 'documents', apiKey: undefined },
      {
        db: harness.database.db,
        isSensitive: flagsSyntheticIdentifiers,
        client: { retries: 0, ...client },
      },
    );

  const runQueued = async (client?: HindsightClientOptions): Promise<void> => {
    const queued = (await harness.database.db.select().from(jobs)).filter(
      ({ kind }) => kind === 'hindsight_sync',
    );
    for (const job of queued) {
      // A job that fails stays, as it would in the queue.
      for (const handler of integration(client).handlers) {
        await handler.run(job.payload, { signal: NEVER_ABORTED, attempt: 1 });
      }
      await harness.database.db.delete(jobs).where(eq(jobs.id, job.id));
    }
  };

  const row = async (id: string) => {
    const [found] = await harness.database.db.select().from(documents).where(eq(documents.id, id));
    if (found === undefined) throw new Error(`The document ${id} does not exist`);
    return found;
  };

  const mayHold = async (id: string) => (await row(id)).hindsightHeldSince !== null;

  const remote = (id: string) => stub.documents.get(`documents/${id}`);

  const indexedDocument = async (label: string) => {
    const bytes = syntheticPdf(label);
    const { id } = await ingestFile(harness.deps, { bytes, filename: 's.pdf', source: 'api' });
    await harness.database.db
      .update(documents)
      .set({ status: 'indexed' })
      .where(eq(documents.id, id));
    await harness.database.db.insert(facts).values({ documentId: id, text: `Fact of ${label}.` });
    return { id, bytes };
  };

  const sentDocument = async (label: string) => {
    const document = await indexedDocument(label);
    await integration().enqueueSync(harness.database.db, document.id);
    await runQueued();
    expect(remote(document.id)).toBeDefined();
    return document;
  };

  const deleteWithHook = (id: string) =>
    deleteDocument(
      {
        db: harness.database.db,
        onDeleted: (tx, document) => integration().enqueueSync(tx, document.id),
      },
      id,
    );

  const flagPrivate = async (id: string): Promise<void> => {
    await harness.database.db.update(documents).set({ private: true }).where(eq(documents.id, id));
    await integration().enqueueSync(harness.database.db, id);
  };

  beforeAll(async () => {
    harness = await createIngestHarness();
    stub = await startHindsightStub({ override: (call, index) => override?.(call, index) });
  });

  afterEach(async () => {
    override = undefined;
    await harness.reset();
  });

  afterAll(async () => {
    await stub.close();
    await harness.dispose();
  });

  it('forgets a deleted document whose sync runs after the same bytes revived it', async () => {
    const { id, bytes } = await sentDocument('revived');
    await deleteWithHook(id);
    const revived = await ingestFile(harness.deps, { bytes, filename: 's.pdf', source: 'api' });
    expect(revived).toMatchObject({ id, status: 'received' });
    expect(await mayHold(id)).toBe(true);

    await runQueued();
    expect({ remote: remote(id), mayHold: await mayHold(id) }).toEqual({
      remote: undefined,
      mayHold: false,
    });
  });

  it('retains the new facts of a revived document, never the ones it was deleted with', async () => {
    const { id, bytes } = await sentDocument('revived and indexed');
    await deleteWithHook(id);
    await ingestFile(harness.deps, { bytes, filename: 's.pdf', source: 'api' });
    await harness.database.db.insert(facts).values({ documentId: id, text: 'A new fact.' });
    await integration().enqueueSync(harness.database.db, id);
    await runQueued();
    expect(remote(id)).toBe(`[doc:${id}] A new fact.`);
  });

  it('forgets a revived document that is flagged private before it is indexed again', async () => {
    const { id, bytes } = await sentDocument('revived then private');
    await deleteWithHook(id);
    await harness.database.db.delete(jobs);
    await ingestFile(harness.deps, { bytes, filename: 's.pdf', source: 'api' });
    await flagPrivate(id);
    await runQueued();
    expect(remote(id)).toBeUndefined();
  });

  it('keeps on the tombstone that a forget is owed after the forget failed', async () => {
    const { id } = await sentDocument('outage');
    await deleteWithHook(id);
    override = () => ({ status: 503, body: { detail: 'synthetic outage' } });
    await expect(runQueued()).rejects.toThrow('Hindsight forget failed (HTTP 503)');
    override = undefined;
    expect(remote(id)).toBeDefined();
    expect({ status: (await row(id)).status, owed: await mayHold(id) }).toEqual({
      status: 'deleted',
      owed: true,
    });

    await harness.database.db.delete(jobs);
    await expect(integration().requeueForgets()).resolves.toBe(1);
    await runQueued();
    expect({ remote: remote(id), owed: await mayHold(id) }).toEqual({
      remote: undefined,
      owed: false,
    });
  });

  it('does not take a 404 with an unknown detail for a forgotten document', async () => {
    const { id } = await sentDocument('proxy');
    await flagPrivate(id);
    override = () => ({ status: 404, body: { detail: 'no such upstream' } });
    await expect(runQueued()).rejects.toThrow('Hindsight forget failed (HTTP 404)');
    expect({ remote: remote(id) !== undefined, owed: await mayHold(id) }).toEqual({
      remote: true,
      owed: true,
    });
  });

  it('forgets a document flagged private after a retain that timed out but was stored', async () => {
    const { id } = await indexedDocument('timed out');
    await integration().enqueueSync(harness.database.db, id);
    // Hindsight stores the memory, and answers after the client gave up.
    const givenUp = createGate();
    override = async () => {
      await givenUp.opened;
      return undefined;
    };
    await expect(runQueued({ timeoutMs: 50 })).rejects.toThrow('Hindsight retain failed (timeout)');
    givenUp.open();
    await waitUntil(() => remote(id) !== undefined);
    override = undefined;
    await harness.database.db.delete(jobs);

    await flagPrivate(id);
    await runQueued();
    expect(remote(id)).toBeUndefined();
  });

  it('leaves out a fact with a valid IBAN once the detector of entities/ is bound', async () => {
    // The binding the server uses, word for word.
    const bound = createHindsightIntegration(
      { url: stub.url, bank: 'documents', apiKey: undefined },
      {
        db: harness.database.db,
        isSensitive: (text) => findSensitiveIdentifiers(text).length > 0,
        client: { retries: 0 },
      },
    );
    const { id } = await indexedDocument('real detector');
    await harness.database.db.insert(facts).values([
      { documentId: id, text: 'Rent is paid from IBAN FR75 9999 9000 01SY NTHE TIC0 146.' },
      { documentId: id, text: 'The reference FR75 0000 is no identifier.' },
    ]);
    await bound.enqueueSync(harness.database.db, id);
    const [job] = await harness.database.db
      .select()
      .from(jobs)
      .where(eq(jobs.kind, 'hindsight_sync'));
    for (const handler of bound.handlers) {
      await handler.run(job?.payload, { signal: NEVER_ABORTED, attempt: 1 });
    }
    expect(remote(id)).toBe(
      `[doc:${id}] Fact of real detector.\n[doc:${id}] The reference FR75 0000 is no identifier.`,
    );
    expect(JSON.stringify(stub.calls)).not.toContain('NTHE');
  });

  it('sends no fact that carries an identifier', async () => {
    const { id } = await sentDocument('screened');
    await harness.database.db
      .insert(facts)
      .values({ documentId: id, text: `Paid from account ${SYNTHETIC_IDENTIFIER}.` });
    await integration().enqueueSync(harness.database.db, id);
    await runQueued();
    expect(remote(id)).toBe(`[doc:${id}] Fact of screened.`);
    expect(JSON.stringify(stub.calls)).not.toContain('FR76');
  });
});
