import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngestHarness, type IngestHarness } from '../ingest/harness.test-helper.ts';
import { startWorkers } from '../jobs/workers.ts';
import { createGate, sleep, waitUntil } from '../testing/async.ts';
import { createSourceHandlers, SOURCE_CONCURRENCY } from './handlers.ts';
import { addSource, fakeConnectors, storedSource, TEST_SECRETS } from './sources.test-helper.ts';

describe('the runs of the sources in the workers', () => {
  let harness: IngestHarness;

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('runs at most two sources at once, whatever the concurrency of the workers', async () => {
    const db = harness.database.db;
    let active = 0;
    let peak = 0;
    const together = createGate();
    const connectors = fakeConnectors([{ cursor: { done: true } }], async () => {
      active += 1;
      peak = Math.max(peak, active);
      if (active >= 2) together.open();
      await together.opened;
      await sleep(40);
      active -= 1;
    });
    const ids = await Promise.all(['a', 'b', 'c', 'd'].map(() => addSource(db)));
    const handlers = createSourceHandlers({ ...harness.deps, secrets: TEST_SECRETS, connectors });
    const workers = await startWorkers({
      db,
      concurrency: 4,
      pollIntervalMs: 20,
      maxPollIntervalMs: 40,
      handlers: () => ({ handlers, perKindConcurrency: SOURCE_CONCURRENCY }),
    });
    try {
      await waitUntil(async () => {
        const sources = await Promise.all(ids.map((id) => storedSource(db, id)));
        return sources.every(({ lastRun }) => lastRun !== null);
      });
    } finally {
      await workers.stop({ timeoutMs: 1000 });
    }
    expect(peak).toBe(2);
  });
});
