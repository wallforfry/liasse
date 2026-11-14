import { describe, expect, it } from 'vitest';
import { createWakeSignal } from './wake-signal.ts';

describe('createWakeSignal', () => {
  it('resolves a wait when notified', async () => {
    const signal = createWakeSignal();
    const waited = signal.wait(60_000);
    signal.notify();
    expect(await waited).toBe('notified');
  });

  it('times out when nobody notifies', async () => {
    expect(await createWakeSignal().wait(5)).toBe('timeout');
  });

  it('keeps a notification sent before the wait, once', async () => {
    const signal = createWakeSignal();
    signal.notify();
    expect(await signal.wait(60_000)).toBe('notified');
    expect(await signal.wait(5)).toBe('timeout');
  });
});
