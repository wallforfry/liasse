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
   * the runner stops. The save itself is not undone.
   */
  readonly afterSave: (tasks: readonly StartupTask[]) => Promise<void>;
  readonly stop: () => void;
}

export const createTaskRunner = (logger: Logger): TaskRunner => {
  let retry: NodeJS.Timeout | undefined;
  let stopped = false;

  const failed = async (tasks: readonly StartupTask[]): Promise<readonly StartupTask[]> => {
    const left: StartupTask[] = [];
    for (const task of tasks) {
      try {
        await task.run();
      } catch (error) {
        logger.event('settings_task_failed', { task: task.name, ...describeError(error) });
        left.push(task);
      }
    }
    return left;
  };

  const attempt = async (tasks: readonly StartupTask[], delayMs: number): Promise<void> => {
    const left = await failed(tasks);
    if (left.length === 0 || stopped) return;
    retry = setTimeout(() => {
      retry = undefined;
      void attempt(left, Math.min(delayMs * 2, TASK_RETRY.maxMs));
    }, delayMs);
  };

  return {
    atBoot: async (tasks) => {
      for (const task of tasks) await step(task.name, task.run);
    },
    afterSave: (tasks) => {
      clearTimeout(retry);
      retry = undefined;
      return attempt(tasks, TASK_RETRY.firstMs);
    },
    stop: () => {
      stopped = true;
      clearTimeout(retry);
    },
  };
};
