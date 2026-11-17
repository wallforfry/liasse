import type { Database } from '../db/client.ts';
import { type RetryPolicy, retryDelayMs } from './backoff.ts';
import {
  DeferJobError,
  JobLockLostError,
  PermanentJobError,
  WorkersStoppingError,
} from './errors.ts';
import type { RegisteredHandler } from './handlers.ts';
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

export interface ExecutionDeps {
  readonly db: Database;
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
  handler: RegisteredHandler | undefined,
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
    : failJob(deps.db, job, lastError, handler?.onTerminalFailure);
};

const runHandler = async (
  deps: ExecutionDeps,
  job: ClaimedJob,
  handler: RegisteredHandler | undefined,
  signal: AbortSignal,
): Promise<boolean> => {
  try {
    if (handler === undefined) throw new PermanentJobError(`No handler for the kind ${job.kind}`);
    await handler.run(job.payload, { signal, attempt: job.attempt });
  } catch (error) {
    return settleFailure(deps, job, handler, error, signal);
  }
  return completeJob(deps.db, job);
};

const run = async (
  deps: ExecutionDeps,
  job: ClaimedJob,
  handler: RegisteredHandler | undefined,
  controller: AbortController,
  renewal: NodeJS.Timeout,
): Promise<void> => {
  try {
    const written = await runHandler(deps, job, handler, controller.signal);
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
 * Runs the job with the handler it was claimed for: one the workers are given in its place
 * meanwhile only runs the jobs claimed after it.
 */
export const executeJob = (
  deps: ExecutionDeps,
  job: ClaimedJob,
  handler: RegisteredHandler | undefined,
): Execution => {
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
    done: run(deps, job, handler, controller, renewal),
    interrupt: () => {
      controller.abort(new WorkersStoppingError());
    },
    abandon: () => {
      clearInterval(renewal);
    },
  };
};
