import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../log.ts';
import type { StartupTask } from './bindings.ts';
import { createTaskRunner, TASK_RETRY } from './startup-tasks.ts';

describe('createTaskRunner after a save', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const counting = (name: string, runs: string[], fails: () => boolean): StartupTask => ({
    name,
    run: () => {
      runs.push(name);
      return fails() ? Promise.reject(new Error('synthetic')) : Promise.resolve();
    },
  });

  it('keeps one chain of retries: a save during a retry replaces it', async () => {
    const runs: string[] = [];
    const runner = createTaskRunner(createLogger(() => undefined));
    await runner.afterSave([counting('first save', runs, () => true)]);
    expect(vi.getTimerCount()).toBe(1);
    await runner.afterSave([counting('second save', runs, () => true)]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(TASK_RETRY.firstMs);
    expect(runs).toEqual(['first save', 'second save', 'second save']);
    await runner.stop();
  });

  it('cancels every pending retry on stop, and runs nothing afterwards', async () => {
    const runs: string[] = [];
    const runner = createTaskRunner(createLogger(() => undefined));
    await runner.afterSave([counting('a task', runs, () => true)]);
    expect(vi.getTimerCount()).toBe(1);
    await runner.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(TASK_RETRY.maxMs);
    expect(runs).toEqual(['a task']);
  });

  it('retries a failed task with a doubling delay until it succeeds', async () => {
    const runs: string[] = [];
    const runner = createTaskRunner(createLogger(() => undefined));
    await runner.afterSave([counting('flaky', runs, () => runs.length < 3)]);
    await vi.advanceTimersByTimeAsync(TASK_RETRY.firstMs);
    expect(runs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(TASK_RETRY.firstMs);
    expect(runs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(TASK_RETRY.firstMs);
    expect(runs).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
    await runner.stop();
  });
});
