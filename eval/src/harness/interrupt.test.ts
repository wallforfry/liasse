import { EventEmitter } from 'node:events';
import { createGate } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { cleanUpOnInterrupt } from './interrupt.ts';

describe('cleanUpOnInterrupt', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('cleans up on %s, then exits with %i', async (signal, code) => {
    const source = new EventEmitter();
    const exited = createGate();
    const events: string[] = [];
    const held = createGate();
    const work = cleanUpOnInterrupt(
      () => {
        events.push('cleanup');
        return Promise.resolve();
      },
      () => held.opened,
      {
        source,
        exit: (exitCode) => {
          events.push(`exit ${String(exitCode)}`);
          exited.open();
        },
      },
    );
    source.emit(signal);
    await exited.opened;
    expect(events).toEqual(['cleanup', `exit ${String(code)}`]);
    held.open();
    await work;
  });

  it('removes its listeners once the work is done', async () => {
    const source = new EventEmitter();
    await cleanUpOnInterrupt(
      () => Promise.resolve(),
      () => Promise.resolve('done'),
      { source },
    );
    expect(source.listenerCount('SIGINT') + source.listenerCount('SIGTERM')).toBe(0);
  });
});
