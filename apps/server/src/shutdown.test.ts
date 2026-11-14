import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createLogger } from './log.ts';
import { installShutdown, runShutdown } from './shutdown.ts';

const setup = () => {
  const signals = new EventEmitter();
  const events: string[] = [];
  const pending: ((clean: boolean) => void)[] = [];
  const failing: ((error: Error) => void)[] = [];
  installShutdown({
    signals,
    stop: () => {
      events.push('stop');
      return new Promise((resolve, reject) => {
        pending.push(resolve);
        failing.push(reject);
      });
    },
    exit: (code) => {
      events.push(`exit ${String(code)}`);
    },
  });
  const settled = async (): Promise<void> => {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  };
  return {
    signals,
    events,
    finish: async (clean: boolean) => {
      pending.splice(0).forEach((resolve) => {
        resolve(clean);
      });
      await settled();
    },
    fail: async () => {
      failing.splice(0).forEach((reject) => {
        reject(new Error('synthetic failure'));
      });
      await settled();
    },
  };
};

describe('installShutdown', () => {
  it('stops nothing before a signal', () => {
    expect(setup().events).toEqual([]);
  });

  it.each(['SIGTERM', 'SIGINT'])('stops, then exits with code 0, on %s', async (signal) => {
    const { signals, events, finish } = setup();
    signals.emit(signal);
    expect(events).toEqual(['stop']);
    await finish(true);
    expect(events).toEqual(['stop', 'exit 0']);
  });

  // The way out of a shutdown that hangs: any second termination signal, the same one
  // or the other, ends the process at once without waiting for the stop.
  it.each([
    ['SIGTERM', 'SIGINT'],
    ['SIGINT', 'SIGTERM'],
    ['SIGTERM', 'SIGTERM'],
    ['SIGINT', 'SIGINT'],
  ])('forces the exit on %s then %s', (first, second) => {
    const { signals, events } = setup();
    signals.emit(first);
    expect(events).toEqual(['stop']);
    signals.emit(second);
    expect(events).toEqual(['stop', 'exit 1']);
  });

  it('stops once, and exits once, whatever follows', async () => {
    const { signals, events, finish } = setup();
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    signals.emit('SIGINT');
    await finish(true);
    expect(events).toEqual(['stop', 'exit 1']);
  });

  it('exits with code 1 when something could not be stopped', async () => {
    const unclean = setup();
    unclean.signals.emit('SIGTERM');
    await unclean.finish(false);
    expect(unclean.events).toEqual(['stop', 'exit 1']);
    const rejected = setup();
    rejected.signals.emit('SIGINT');
    await rejected.fail();
    expect(rejected.events).toEqual(['stop', 'exit 1']);
  });

  it('ignores other signals', () => {
    const { signals, events } = setup();
    signals.emit('SIGHUP');
    expect(events).toEqual([]);
  });
});

describe('runShutdown', () => {
  const run = async (failingStep?: string) => {
    const events: string[] = [];
    const lines: string[] = [];
    const step = (name: string) => ({
      name,
      run: () => {
        events.push(name);
        return name === failingStep
          ? Promise.reject(new Error('password=synthetic-secret'))
          : Promise.resolve();
      },
    });
    const clean = await runShutdown(
      ['http', 'watcher', 'workers', 'embedder', 'database'].map(step),
      createLogger((line) => lines.push(line)),
    );
    return { events, lines, clean };
  };

  it('runs the steps in order', async () => {
    expect(await run()).toEqual({
      events: ['http', 'watcher', 'workers', 'embedder', 'database'],
      lines: [],
      clean: true,
    });
  });

  it('still runs the next steps when one fails, and reports it without its message', async () => {
    const { events, lines, clean } = await run('http');
    expect(events).toEqual(['http', 'watcher', 'workers', 'embedder', 'database']);
    expect(clean).toBe(false);
    expect(lines).toEqual(['{"event":"shutdown_step_failed","step":"http","error":"Error"}']);
  });
});
