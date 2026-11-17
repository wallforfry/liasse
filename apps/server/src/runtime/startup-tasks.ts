import { describeError, type Logger } from '../log.ts';
import type { StartupTask } from './bindings.ts';
import { step } from './step.ts';

export const TASK_RETRY = { firstMs: 1000, maxMs: 5 * 60_000 } as const;

export interface TaskRunner {
  /** At startup: the first task that fails stops the start, as it always did. */
  readonly atBoot: (tasks: readonly StartupTask[]) => Promise<void>;
  /**
   * After a save: a task that fails is logged and tried again, with a delay that doubles
   * up to `TASK_RETRY.maxMs`, until it succeeds, the next save runs the tasks again, or
   * the runner stops. The save itself is not undone. One chain of attempts at a time: a
   * save replaces the chain of the save before it.
   */
  readonly afterSave: (tasks: readonly StartupTask[]) => Promise<void>;
  /** Cancels the pending retry and resolves once the attempt in progress, if any, ends. */
  readonly stop: () => Promise<void>;
}

export const createTaskRunner = (logger: Logger): TaskRunner => {
  let retry: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  // Each save starts a chain of its own; an older chain ends at its next step.
  let chain = 0;
  let stopped = false;

  const current = (owner: number): boolean => owner === chain && !stopped;

  const failed = async (
    tasks: readonly StartupTask[],
    owner: number,
  ): Promise<readonly StartupTask[]> => {
    const left: StartupTask[] = [];
    for (const task of tasks) {
      if (!current(owner)) return [];
      try {
        await task.run();
      } catch (error) {
        logger.event('settings_task_failed', { task: task.name, ...describeError(error) });
        left.push(task);
      }
    }
    return left;
  };

  const attempt = async (
    tasks: readonly StartupTask[],
    delayMs: number,
    owner: number,
  ): Promise<void> => {
    const left = await failed(tasks, owner);
    if (left.length === 0 || !current(owner)) return;
    retry = setTimeout(() => {
      retry = undefined;
      running = attempt(left, Math.min(delayMs * 2, TASK_RETRY.maxMs), owner);
    }, delayMs);
  };

  return {
    atBoot: async (tasks) => {
      for (const task of tasks) await step(task.name, task.run);
    },
    afterSave: async (tasks) => {
      clearTimeout(retry);
      retry = undefined;
      chain += 1;
      const owner = chain;
      // The attempt of an older chain finishes the task it is running, then stops.
      await running;
      running = attempt(tasks, TASK_RETRY.firstMs, owner);
      await running;
    },
    stop: async () => {
      stopped = true;
      clearTimeout(retry);
      retry = undefined;
      await running;
    },
  };
};
