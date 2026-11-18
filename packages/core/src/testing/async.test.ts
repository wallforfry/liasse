import { describe, expect, it } from 'vitest';
import { createGate, waitUntil } from './async.ts';

describe('createGate', () => {
  it('hands the value it is opened with to whoever waits on it', async () => {
    const gate = createGate<number>();
    gate.open(42);
    expect(await gate.opened).toBe(42);
  });
});

describe('waitUntil', () => {
  it('resolves once the condition holds', async () => {
    let checks = 0;
    await waitUntil(() => {
      checks += 1;
      return checks === 3;
    });
    expect(checks).toBe(3);
  });

  it('stops polling once its signal aborts, with the reason of the signal', async () => {
    const controller = new AbortController();
    let checks = 0;
    const waiting = waitUntil(
      () => {
        checks += 1;
        if (checks === 2) controller.abort(new Error('synthetic end of the test'));
        return false;
      },
      { signal: controller.signal },
    );
    await expect(waiting).rejects.toThrow('synthetic end of the test');
    expect(checks).toBe(2);
  });
});
