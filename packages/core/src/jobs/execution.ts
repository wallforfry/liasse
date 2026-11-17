import type { Database } from '../db/client.ts';
import { type RetryPolicy, retryDelayMs } from './backoff.ts';
import {
  DeferJobError,
  JobLockLostError,
  PermanentJobError,
  WorkersStoppingError,
} from './errors.ts';
import type { ActiveHandlers, RegisteredHandler } from './handlers.ts';
import { describeJobError } from './last-error.ts';
import {
  type ClaimedJob,
  completeJob,
  deferJob,
  failJob,
  releaseJob,
  renewJobLock,
  retryJob,
} from './store.ts';

export interface JobFailure {
  readonly job: Pick<ClaimedJob, 'id' | 'kind' | 'attempt'>;
  readonly error: unknown;
  readonly willRetry: boolean;
}

export interface JobDeferral {
  readonly job: Pick<ClaimedJob, 'id' | 'kind' | 'attempt'>;
  readonly error: DeferJobError;
  readonly delayMs: number;
}

/** How the workers keep the settings of their handlers up to the version of a job. */
export interface SettingsFollower {
  /** The version of the stored settings the handlers in force were built from. */
  readonly applied: () => number;
  /** Reads the stored settings and puts newer ones in force; resolves once it tried. */
  readonly catchUp: () => Promise<void>;
}

export interface ExecutionDeps {
  readonly db: Database;
  /** Read once a job is claimed, after any catch-up: its handler runs the job. */
  readonly handlers: () => ActiveHandlers;
  readonly settings?: SettingsFollower;
  /** The deferral of a job that cannot run yet, by the settings version it was queued under. */
  readonly notReadyDelay: (settingsVersion: number) => number;
  readonly retry: RetryPolicy;
  readonly lockRenewalMs: number;
  readonly onJobFailed: (failure: JobFailure) => void;
  readonly onJobDeferred: (deferral: JobDeferral) => void;
  readonly onError: (error: unknown) => void;
}

export interface Execution {
  readonly job: ClaimedJob;
  /** Settles once the job row is written back. Never rejects. */
  readonly done: Promise<void>;
  /** Aborts the handler because the workers are stopping. */
  readonly interrupt: () => void;
  /**
   * Stops renewing the lock of a handler that ignored its abort. The lock then expires
   * and the job is taken back, instead of staying `running` for as long as the process
   * lives; the timer no longer keeps that process alive either.
   */
  readonly abandon: () => void;
}

// Reported once the job is back in the queue: a lease lost meanwhile deferred nothing.
const defer = async (
  deps: ExecutionDeps,
  job: ClaimedJob,
  error: DeferJobError,
): Promise<boolean> => {
  const delayMs = error.delayMs ?? retryDelayMs(1, deps.retry);
  const deferred = await deferJob(deps.db, job, delayMs);
  if (deferred) deps.onJobDeferred({ job, error, delayMs });
  return deferred;
};

const settleFailure = (
  deps: ExecutionDeps,
  job: ClaimedJob,
  handler: RegisteredHandler,
  error: unknown,
  signal: AbortSignal,
): Promise<boolean> => {
  if (signal.reason instanceof WorkersStoppingError) return releaseJob(deps.db, job);
  if (error instanceof DeferJobError) return defer(deps, job, error);
  const willRetry = !(error instanceof PermanentJobError) && job.attempt < job.maxAttempts;
  deps.onJobFailed({ job, error, willRetry });
  const lastError = describeJobError(error);
  return willRetry
    ? retryJob(deps.db, job, lastError, retryDelayMs(job.attempt, deps.retry))
    : failJob(deps.db, job, lastError, handler.onTerminalFailure);
};

const runHandler = async (
  deps: ExecutionDeps,
  job: ClaimedJob,
  handler: RegisteredHandler,
  signal: AbortSignal,
): Promise<boolean> => {
  try {
    await handler.run(job.payload, { signal, attempt: job.attempt });
  } catch (error) {
    return settleFailure(deps, job, handler, error, signal);
  }
  return completeJob(deps.db, job);
};

/**
 * How long a job that cannot run yet waits in the queue, its attempt not counted: one queued
 * under settings this process could not catch up with, or of a kind the set in force no
 * longer has. The delay doubles at each deferral for one settings version, up to the cap,
 * so a process that never catches up does not claim the job every second.
 */
export const NOT_READY_DELAY = { firstMs: 1000, maxMs: 5 * 60_000 } as const;

export const createNotReadyDelay = (): ((settingsVersion: number) => number) => {
  const next = new Map<number, number>();
  return (settingsVersion) => {
    const delayMs = next.get(settingsVersion) ?? NOT_READY_DELAY.firstMs;
    next.set(settingsVersion, Math.min(delayMs * 2, NOT_READY_DELAY.maxMs));
    return delayMs;
  };
};

const settingsCaughtUp = async (deps: ExecutionDeps, job: ClaimedJob): Promise<boolean> => {
  const { settings } = deps;
  if (settings === undefined || job.settingsVersion <= settings.applied()) return true;
  await settings.catchUp().catch(deps.onError);
  return job.settingsVersion <= settings.applied();
};

// Undefined when the job must not run now: never with parts older than its settings.
const handlerFor = async (
  deps: ExecutionDeps,
  job: ClaimedJob,
): Promise<RegisteredHandler | undefined> =>
  (await settingsCaughtUp(deps, job)) ? deps.handlers().registry.get(job.kind) : undefined;

const run = async (
  deps: ExecutionDeps,
  job: ClaimedJob,
  controller: AbortController,
  renewal: NodeJS.Timeout,
): Promise<void> => {
  try {
    const handler = await handlerFor(deps, job);
    const written =
      handler === undefined
        ? await deferJob(deps.db, job, deps.notReadyDelay(job.settingsVersion))
        : await runHandler(deps, job, handler, controller.signal);
    if (!written) deps.onError(new JobLockLostError());
  } catch (error) {
    // The row could not be written back. It stays `running` without renewal, so the
    // stale-lock recovery returns it to the queue.
    deps.onError(error);
  } finally {
    clearInterval(renewal);
  }
};

/**
 * Runs the job with the handler of the set in force once it is claimed, after the settings
 * of this process caught up with those of the job. A set given in its place later only
 * runs the jobs claimed after it.
 */
export const executeJob = (deps: ExecutionDeps, job: ClaimedJob): Execution => {
  const controller = new AbortController();
  // A handler that outlives the visibility timeout keeps its job as long as its
  // process answers: only a silent worker loses it.
  const renewal = setInterval(() => {
    renewJobLock(deps.db, job).then((held) => {
      if (!held) controller.abort(new JobLockLostError());
    }, deps.onError);
  }, deps.lockRenewalMs);
  return {
    job,
    done: run(deps, job, controller, renewal),
    interrupt: () => {
      controller.abort(new WorkersStoppingError());
    },
    abandon: () => {
      clearInterval(renewal);
    },
  };
};
