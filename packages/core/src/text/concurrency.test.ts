import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.ts';

interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

const createGate = (): Gate => {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

describe('mapWithConcurrency', () => {
  it('returns results in item order whatever the completion order', async () => {
    const gates = [createGate(), createGate(), createGate()];
    const finished: number[] = [];
    const mapped = mapWithConcurrency([0, 1, 2], 3, async (item) => {
      await gates[item]?.promise;
      finished.push(item);
      return `item ${String(item)}`;
    });
    gates[2]?.open();
    gates[1]?.open();
    gates[0]?.open();
    expect(await mapped).toEqual(['item 0', 'item 1', 'item 2']);
    expect(finished).toEqual([2, 1, 0]);
  });

  it('never runs more tasks at once than the limit', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
    });
    expect(peak).toBe(3);
  });

  it('runs one task at a time when the limit is below one', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3], 0, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
    });
    expect(peak).toBe(1);
  });

  it('starts no new task after a failure and rethrows it', async () => {
    const started: number[] = [];
    const mapped = mapWithConcurrency([0, 1, 2, 3], 1, (item) => {
      started.push(item);
      return item === 1 ? Promise.reject(new Error('task 1 failed')) : Promise.resolve(item);
    });
    await expect(mapped).rejects.toThrow('task 1 failed');
    expect(started).toEqual([0, 1]);
  });

  it('waits for the tasks already running before it rejects', async () => {
    const gate = createGate();
    let slowFinished = false;
    const mapped = mapWithConcurrency(['slow', 'failing'], 2, async (item) => {
      if (item === 'failing') throw new Error('failed first');
      await gate.promise;
      slowFinished = true;
    });
    const outcome = mapped.then(
      () => 'resolved',
      () => (slowFinished ? 'rejected after the slow task' : 'rejected too early'),
    );
    await Promise.resolve();
    gate.open();
    expect(await outcome).toBe('rejected after the slow task');
  });

  it('returns an empty list for no items', async () => {
    expect(await mapWithConcurrency([], 2, () => Promise.resolve(1))).toEqual([]);
  });
});
