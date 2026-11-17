import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGate, waitUntil } from '../testing/async.ts';
import { enqueue } from './enqueue.ts';
import { handle, type HandlerSet } from './handlers.ts';
import { labelJob, otherJob } from './kinds.test-helper.ts';
import { createWorkersHarness, type WorkersHarness } from './workers.test-helper.ts';

describe('workers following a handler set', () => {
  let harness: WorkersHarness;

  beforeAll(async () => {
    harness = await createWorkersHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const succeeded = (id: string) => async () => (await harness.statusOf(id)) === 'succeeded';

  it('runs a job with the handler of the set in force when it is claimed', async () => {
    const seen: string[] = [];
    const release = createGate();
    const started = createGate();
    const setOf = (name: string): HandlerSet => ({
      handlers: [
        handle(labelJob, async ({ payload }) => {
          if (payload.label === 'slow') {
            started.open();
            await release.opened;
          }
          seen.push(`${payload.label}:${name}`);
        }),
      ],
    });
    let current = setOf('first');
    await harness.start({ handlers: () => current });

    const slow = await harness.queue('slow');
    await started.opened;
    current = setOf('second');
    const after = await harness.queue('after');
    await waitUntil(succeeded(after));
    release.open();
    await waitUntil(succeeded(slow));

    expect(seen).toEqual(['after:second', 'slow:first']);
  });

  it('claims a kind only while the set in force has its handler', async () => {
    const ran: string[] = [];
    const record = ({ payload }: { readonly payload: { readonly label: string } }) => {
      ran.push(payload.label);
      return Promise.resolve();
    };
    let current: HandlerSet = { handlers: [handle(otherJob, record)] };
    await harness.start({ handlers: () => current });

    const waiting = await harness.queue('label');
    const other = await enqueue(harness.database.db, {
      kind: otherJob,
      payload: { label: 'other' },
    });
    await waitUntil(succeeded(other));
    expect(await harness.statusOf(waiting)).toBe('queued');

    current = { handlers: [handle(otherJob, record), handle(labelJob, record)] };
    await waitUntil(succeeded(waiting));
    expect(ran).toEqual(['other', 'label']);
  });
});
