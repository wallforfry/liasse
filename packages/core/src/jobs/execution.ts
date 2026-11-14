import type { Database } from '../db/client.ts';
import { type RetryPolicy, retryDelayMs } from './backoff.ts';
import { JobLockLostError, PermanentJobError, WorkersStoppingError } from './errors.ts';
import type { RegisteredHandler } from './handlers.ts';
import { describeJobError } from './last-error.ts';
import {
  type ClaimedJob,
  completeJob,
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

export interface ExecutionDeps {
  readonly db: Database;
  readonly handlers: ReadonlyMap<string, RegisteredHandler>;
  readonly retry: RetryPolicy;
  readonly lockRenewalMs: number;
  readonly onJobFailed: (failure: JobFailure) => void;
  readonly onError: (error: unknown) => void;
}

export interface Execution {
  readonly job: ClaimedJob;
  /** Settles once the job row is written back. Never rejects. */
  readonly done: Promise<void>;
  /** Aborts the handler because the workers are stopping. */
  readonly interrupt: () => void;
}

const settleFailure = (
  deps: ExecutionDeps,
  job: ClaimedJob,
  error: unknown,
  signal: AbortSignal,
): Promise<boolean> => {
  if (signal.reason instanceof WorkersStoppingError) return releaseJob(deps.db, job);
  const willRetry = !(error instanceof PermanentJobError) && job.attempt < job.maxAttempts;
  deps.onJobFailed({ job, error, willRetry });
  const lastError = describeJobError(error);
  return willRetry
    ? retryJob(deps.db, job, lastError, retryDelayMs(job.attempt, deps.retry))
    : failJob(deps.db, job, lastError);
};

const runHandler = async (
  deps: ExecutionDeps,
  job: ClaimedJob,
  signal: AbortSignal,
): Promise<boolean> => {
  try {
    const handler = deps.handlers.get(job.kind);
    if (handler === undefined) throw new PermanentJobError(`No handler for the kind ${job.kind}`);
    await handler.run(job.payload, { signal, attempt: job.attempt });
  } catch (error) {
    return settleFailure(deps, job, error, signal);
  }
  return completeJob(deps.db, job);
};

const run = async (
  deps: ExecutionDeps,
  job: ClaimedJob,
  controller: AbortController,
): Promise<void> => {
  // A handler that outlives the visibility timeout keeps its job as long as its
  // process answers: only a silent worker loses it.
  const renewal = setInterval(() => {
    renewJobLock(deps.db, job).then((held) => {
      if (!held) controller.abort(new JobLockLostError());
    }, deps.onError);
  }, deps.lockRenewalMs);
  try {
    const written = await runHandler(deps, job, controller.signal);
    if (!written) deps.onError(new JobLockLostError());
  } catch (error) {
    // The row could not be written back. It stays `running` without renewal, so the
    // stale-lock recovery returns it to the queue.
    deps.onError(error);
  } finally {
    clearInterval(renewal);
  }
};

export const executeJob = (deps: ExecutionDeps, job: ClaimedJob): Execution => {
  const controller = new AbortController();
  return {
    job,
    done: run(deps, job, controller),
    interrupt: () => {
      controller.abort(new WorkersStoppingError());
    },
  };
};
