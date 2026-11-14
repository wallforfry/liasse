import { describe, expect, it, vi } from 'vitest';
import {
  createIdleResource,
  type IdleResourceOptions,
  scheduleUnrefTimeout,
  type ScheduleTimer,
} from './idle-resource.ts';

interface Instance {
  readonly id: number;
}

interface ScheduledTimer {
  readonly callback: () => void;
  readonly delayMs: number;
  cancelled: boolean;
}

const manualTimers = () => {
  const timers: ScheduledTimer[] = [];
  const schedule: ScheduleTimer = (callback, delayMs) => {
    const timer: ScheduledTimer = { callback, delayMs, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const pending = (): readonly ScheduledTimer[] => timers.filter((timer) => !timer.cancelled);
  return { schedule, timers, pending };
};

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const setup = (overrides: Partial<IdleResourceOptions<Instance>> = {}) => {
  const timers = manualTimers();
  const disposed: number[] = [];
  const unloadErrors: unknown[] = [];
  let loads = 0;
  const resource = createIdleResource<Instance>({
    load: () => {
      loads += 1;
      return Promise.resolve({ id: loads });
    },
    dispose: (instance) => {
      disposed.push(instance.id);
      return Promise.resolve();
    },
    idleMs: 600_000,
    onUnloadError: (error) => unloadErrors.push(error),
    schedule: timers.schedule,
    ...overrides,
  });
  const idOf = (instance: Instance): Promise<number> => Promise.resolve(instance.id);
  return { resource, timers, disposed, unloadErrors, loadCount: () => loads, idOf };
};

describe('createIdleResource', () => {
  it('loads nothing until the first use', async () => {
    const { resource, loadCount, idOf } = setup();
    expect(loadCount()).toBe(0);
    expect(await resource.use(idOf)).toBe(1);
    expect(loadCount()).toBe(1);
  });

  it('shares one instance between concurrent and successive uses', async () => {
    const { resource, loadCount, idOf } = setup();
    expect(await Promise.all([resource.use(idOf), resource.use(idOf)])).toEqual([1, 1]);
    expect(await resource.use(idOf)).toBe(1);
    expect(loadCount()).toBe(1);
  });

  it('schedules the unload once the last user is done, after the idle delay', async () => {
    const { resource, timers } = setup();
    const gate = deferred();
    const first = resource.use(() => gate.promise);
    const second = resource.use(() => gate.promise);
    await Promise.resolve();
    expect(timers.timers).toEqual([]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(timers.pending().map((timer) => timer.delayMs)).toEqual([600_000]);
  });

  it('restarts the idle delay on every use', async () => {
    const { resource, timers, idOf } = setup();
    await resource.use(idOf);
    await resource.use(idOf);
    expect(timers.timers.map((timer) => timer.cancelled)).toEqual([true, false]);
  });

  it('disposes of the instance when idle, then loads a new one on the next use', async () => {
    const { resource, timers, disposed, idOf } = setup();
    await resource.use(idOf);
    timers.pending()[0]?.callback();
    await vi.waitFor(() => {
      expect(disposed).toEqual([1]);
    });
    expect(await resource.use(idOf)).toBe(2);
    expect(disposed).toEqual([1]);
  });

  it('makes a use that arrives during the unload wait, then gives it a fresh instance', async () => {
    const disposal = deferred();
    const events: string[] = [];
    let loads = 0;
    const timers = manualTimers();
    const resource = createIdleResource<Instance>({
      load: () => {
        loads += 1;
        events.push(`load ${String(loads)}`);
        return Promise.resolve({ id: loads });
      },
      dispose: async (instance) => {
        events.push(`dispose ${String(instance.id)} starts`);
        await disposal.promise;
        events.push(`dispose ${String(instance.id)} ends`);
      },
      idleMs: 1,
      onUnloadError: () => undefined,
      schedule: timers.schedule,
    });
    await resource.use(() => Promise.resolve());
    timers.pending()[0]?.callback();
    await vi.waitFor(() => {
      expect(events).toContain('dispose 1 starts');
    });
    const late = resource.use((instance) => Promise.resolve(instance.id));
    await Promise.resolve();
    expect(events).toEqual(['load 1', 'dispose 1 starts']);
    disposal.resolve();
    expect(await late).toBe(2);
    expect(events).toEqual(['load 1', 'dispose 1 starts', 'dispose 1 ends', 'load 2']);
  });

  it('retries the load after a failure and schedules no unload for it', async () => {
    let attempts = 0;
    const { resource, timers, idOf } = setup({
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('synthetic load failure'))
          : Promise.resolve({ id: attempts });
      },
    });
    await expect(resource.use(idOf)).rejects.toThrow('synthetic load failure');
    expect(timers.timers).toEqual([]);
    expect(await resource.use(idOf)).toBe(2);
  });

  it('reports a failed idle unload and still serves the next use', async () => {
    const failure = new Error('synthetic dispose failure');
    const { resource, timers, unloadErrors, idOf } = setup({
      dispose: () => Promise.reject(failure),
    });
    await resource.use(idOf);
    timers.pending()[0]?.callback();
    await vi.waitFor(() => {
      expect(unloadErrors).toEqual([failure]);
    });
    expect(await resource.use(idOf)).toBe(2);
  });

  it('unloads on demand, cancels the pending timer and rejects when the disposal fails', async () => {
    const { resource, timers, disposed, idOf } = setup();
    await resource.unload();
    expect(disposed).toEqual([]);
    await resource.use(idOf);
    await resource.unload();
    expect(disposed).toEqual([1]);
    expect(timers.pending()).toEqual([]);

    const failing = setup({
      dispose: () => Promise.reject(new Error('synthetic dispose failure')),
    });
    await failing.resource.use(failing.idOf);
    await expect(failing.resource.unload()).rejects.toThrow('synthetic dispose failure');
  });
});

describe('scheduleUnrefTimeout', () => {
  const activeTimeouts = (): number =>
    process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;

  it('never keeps the process alive', () => {
    const before = activeTimeouts();
    const cancel = scheduleUnrefTimeout(() => undefined, 60_000);
    try {
      expect(activeTimeouts()).toBe(before);
    } finally {
      cancel();
    }
  });

  it('fires after the delay unless cancelled', async () => {
    const cancelled = vi.fn();
    scheduleUnrefTimeout(cancelled, 1)();
    await new Promise<void>((resolve) => {
      scheduleUnrefTimeout(resolve, 5);
    });
    expect(cancelled).not.toHaveBeenCalled();
  });
});
