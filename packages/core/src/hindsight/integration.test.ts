import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/load.ts';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { facts } from '../db/schema/knowledge.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { flagsNothing, flagsSyntheticIdentifiers } from './detector.test-helper.ts';
import {
  createHindsightIntegration,
  describeHindsight,
  type HindsightIntegration,
  type HindsightIntegrationDeps,
} from './integration.ts';
import { type HindsightStub, startHindsightStub } from './stub.test-helper.ts';
import type { WithheldFacts } from './sync-job.ts';

const NEVER_ABORTED = new AbortController().signal;
const SYNTHETIC_KEY = 'synthetic-hindsight-key-0001';

describe('createHindsightIntegration', () => {
  let database: TestDatabase;
  let stub: HindsightStub;

  const documentWithFact = async (text = 'A synthetic fact.'): Promise<string> => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'indexed' });
    await database.db.insert(facts).values({ documentId: id, text });
    return id;
  };

  const hindsightJobs = async () =>
    (await database.db.select().from(jobs)).filter(({ kind }) => kind === 'hindsight_sync');

  const enabled = (deps: Partial<HindsightIntegrationDeps> = {}, bank = 'documents') =>
    createHindsightIntegration(
      loadConfig({
        ...SYNTHETIC_ENV,
        HINDSIGHT_URL: stub.url,
        HINDSIGHT_BANK: bank,
        HINDSIGHT_API_KEY: SYNTHETIC_KEY,
      }).hindsight,
      { db: database.db, isSensitive: flagsNothing, client: { retries: 0 }, ...deps },
    );

  const runQueued = async (integration: HindsightIntegration): Promise<void> => {
    for (const job of await hindsightJobs()) {
      for (const handler of integration.handlers.filter(({ kind }) => kind === job.kind)) {
        await handler.run(job.payload, { signal: NEVER_ABORTED, attempt: 1 });
      }
    }
    await database.db.delete(jobs);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    stub = await startHindsightStub({ apiKey: SYNTHETIC_KEY });
  });

  afterEach(async () => {
    await database.db.delete(jobs);
    await database.db.delete(documents);
  });

  afterAll(async () => {
    await stub.close();
    await database.dispose();
  });

  it('is disabled without HINDSIGHT_URL: no job, no handler, no client, no request', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    const before = stub.calls.length;
    const { hindsight } = loadConfig({ ...SYNTHETIC_ENV, HINDSIGHT_API_KEY: SYNTHETIC_KEY });
    expect(hindsight).toBeUndefined();
    const integration = createHindsightIntegration(hindsight, {
      db: database.db,
      isSensitive: flagsNothing,
      client: { fetch: fetchSpy },
    });
    expect(integration.enabled).toBe(false);
    expect(integration.handlers).toEqual([]);
    expect(integration.perKindConcurrency).toEqual({});

    const id = await documentWithFact();
    await database.db
      .update(documents)
      .set({ private: true, hindsightHeldSince: new Date('2026-01-01T00:00:00Z') });
    await integration.enqueueSync(database.db, id);
    await expect(integration.requeueForgets()).resolves.toBe(0);
    await deleteDocument(
      { db: database.db, onDeleted: (tx, document) => integration.enqueueSync(tx, document.id) },
      id,
    );
    expect(await hindsightJobs()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(before);
  });

  it('queues a sync and registers its handler once HINDSIGHT_URL is set', async () => {
    const integration = enabled();
    expect(integration.enabled).toBe(true);
    expect(integration.handlers.map(({ kind }) => kind)).toEqual(['hindsight_sync']);
    expect(integration.perKindConcurrency).toEqual({ hindsight_sync: 2 });
    const id = await documentWithFact();
    await integration.enqueueSync(database.db, id);
    expect(await hindsightJobs()).toMatchObject([{ payload: { documentId: id } }]);

    await runQueued(integration);
    expect(stub.documents.get(`documents/${id}`)).toBe(`[doc:${id}] A synthetic fact.`);
    expect(stub.calls.at(-1)?.headers.authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
  });

  it('forgets a deleted document through the hook of the deletion', async () => {
    const integration = enabled();
    const id = await documentWithFact();
    await integration.enqueueSync(database.db, id);
    await runQueued(integration);
    expect(stub.documents.has(`documents/${id}`)).toBe(true);

    await deleteDocument(
      { db: database.db, onDeleted: (tx, document) => integration.enqueueSync(tx, document.id) },
      id,
    );
    expect(await hindsightJobs()).toMatchObject([{ payload: { documentId: id } }]);
    await runQueued(integration);
    expect(stub.documents.has(`documents/${id}`)).toBe(false);
  });

  it('queues again the forgets that are still owed', async () => {
    const integration = enabled();
    const id = await documentWithFact();
    await integration.enqueueSync(database.db, id);
    await runQueued(integration);
    await deleteDocument({ db: database.db }, id);
    await insertSyntheticDocument(database.db, {
      private: true,
      hindsightHeldSince: new Date('2030-01-01T00:00:00Z'),
    });

    await expect(integration.requeueForgets({ limit: 1 })).resolves.toBe(1);
    await runQueued(integration);
    expect(stub.documents.has(`documents/${id}`)).toBe(false);
    await expect(integration.requeueForgets()).resolves.toBe(1);
    await runQueued(integration);
    await expect(integration.requeueForgets()).resolves.toBe(0);
  });

  it('retains again once another bank is configured', async () => {
    const id = await documentWithFact();
    for (const bank of ['documents', 'household']) {
      const integration = enabled({}, bank);
      await integration.enqueueSync(database.db, id);
      await runQueued(integration);
      expect(stub.documents.has(`${bank}/${id}`)).toBe(true);
    }
  });

  it('uses the client options it is given', async () => {
    const fetchSpy = vi.fn<typeof fetch>(() => Promise.reject(new Error('synthetic')));
    const integration = enabled({ client: { fetch: fetchSpy, retries: 0 } });
    const id = await documentWithFact();
    await integration.enqueueSync(database.db, id);
    await expect(runQueued(integration)).rejects.toMatchObject({ code: 'network' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('screens the facts with the detector it is given, and reports what it kept out', async () => {
    const withheld: WithheldFacts[] = [];
    const integration = enabled({
      isSensitive: flagsSyntheticIdentifiers,
      onFactsWithheld: (report) => {
        withheld.push(report);
      },
    });
    const id = await documentWithFact('Paid from account FR76 0000 SYNTHETIC.');
    const before = stub.calls.length;
    await integration.enqueueSync(database.db, id);
    await runQueued(integration);
    expect(stub.calls).toHaveLength(before);
    expect(withheld).toEqual([{ documentId: id, count: 1 }]);
  });

  it('cannot be created without a detector of sensitive identifiers', () => {
    const withoutDetector = () =>
      // @ts-expect-error The detector is required: a fact is free model text.
      createHindsightIntegration(undefined, { db: database.db });
    expect(withoutDetector().enabled).toBe(false);
  });
});

describe('describeHindsight', () => {
  it('says nothing when the integration is disabled', () => {
    expect(describeHindsight(loadConfig(SYNTHETIC_ENV))).toBeUndefined();
  });

  it('names the host and the bank the facts go to, and neither the key nor the path', () => {
    const line = describeHindsight(
      loadConfig({
        ...SYNTHETIC_ENV,
        HINDSIGHT_URL: 'https://hindsight.example.test:8443/synthetic-path',
        HINDSIGHT_BANK: 'household',
        HINDSIGHT_API_KEY: SYNTHETIC_KEY,
      }),
    );
    expect(line).toBe(
      'Warning: facts extracted from documents not flagged private are sent to Hindsight at ' +
        'hindsight.example.test:8443 (bank household). Unset HINDSIGHT_URL to keep them local.',
    );
  });
});
