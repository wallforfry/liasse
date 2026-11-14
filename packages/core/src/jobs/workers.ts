import type { Database } from '../db/client.ts';
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from './backoff.ts';
import { JOBS_CHANNEL } from './enqueue.ts';
import { startDispatcher } from './dispatcher.ts';
import { InvalidWorkersOptionsError } from './errors.ts';
import type { Execution, JobDeferral, JobFailure } from './execution.ts';
import { createHandlerRegistry, type RegisteredHandler } from './handlers.ts';
import { recoverStaleJobs, terminalFailureHooks } from './store.ts';
import { createWakeSignal } from './wake-signal.ts';

export interface WorkersOptions {
  readonly db: Database;
  readonly handlers: readonly RegisteredHandler[];
  /** Jobs run in parallel by this process. */
  readonly concurrency: number;
  /** Upper bound per kind, within this process. A kind left out is bound by `concurrency` only. */
  readonly perKindConcurrency?: Readonly<Record<string, number>>;
  /** Idle polling starts at `pollIntervalMs` and doubles up to `maxPollIntervalMs`. */
  readonly pollIntervalMs?: number;
  readonly maxPollIntervalMs?: number;
  /** A running job whose lock was not renewed for this long is taken back. */
  readonly visibilityTimeoutMs?: number;
  /** How often a running job renews its lock. A third of the visibility timeout by default. */
  readonly lockRenewalMs?: number;
  readonly retry?: RetryPolicy;
  readonly onJobFailed?: (failure: JobFailure) => void;
  /** Called for a job a handler deferred with `DeferJobError`: not a failure. */
  readonly onJobDeferred?: (deferral: JobDeferral) => void;
  /** Called for a failure of the queue itself, such as an unreachable database. */
  readonly onError?: (error: unknown) => void;
}

export interface StopOptions {
  /** How long in-flight jobs may finish before their handlers are aborted. */
  readonly timeoutMs?: number;
  /** How long aborted handlers may take to return. */
  readonly abortGraceMs?: number;
}

export interface StopReport {
  /** Jobs whose handler was aborted. Those that returned are back in the queue. */
  readonly aborted: readonly string[];
  /** Jobs whose handler ignored the abort; the stale-lock recovery requeues them. */
  readonly abandoned: readonly string[];
}

export interface Workers {
  readonly stop: (options?: StopOptions) => Promise<StopReport>;
}

const DEFAULTS = {
  pollIntervalMs: 250,
  maxPollIntervalMs: 5000,
  visibilityTimeoutMs: 300_000,
  stopTimeoutMs: 30_000,
  abortGraceMs: 5000,
} as const;
const LOCK_RENEWALS_PER_TIMEOUT = 3;
const MIN_RENEWALS_PER_TIMEOUT = 2;
const RECOVERIES_PER_TIMEOUT = 2;

// A renewal period close to the visibility timeout lets one late renewal hand a live
// job to another worker: at least two renewals must fit in the timeout.
const lockRenewalOf = (requested: number | undefined, visibilityTimeoutMs: number): number => {
  if (requested === undefined) return visibilityTimeoutMs / LOCK_RENEWALS_PER_TIMEOUT;
  if (requested > 0 && requested <= visibilityTimeoutMs / MIN_RENEWALS_PER_TIMEOUT)
    return requested;
  throw new InvalidWorkersOptionsError(
    `lockRenewalMs must be positive and at most half of visibilityTimeoutMs (${String(visibilityTimeoutMs)} ms)`,
  );
};

const settledWithin = async (
  executions: readonly Execution[],
  timeoutMs: number,
): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([Promise.all(executions.map(({ done }) => done)), deadline]);
  clearTimeout(timer);
};

// LISTEN needs a session of its own, which postgres.js opens and reopens by itself. A
// server that refuses it (a transaction pooler) leaves the queue on polling alone.
const listenForJobs = async (db: Database, onNotify: () => void): Promise<() => Promise<void>> => {
  const subscription = await db.$client.listen(JOBS_CHANNEL, onNotify);
  return () => subscription.unlisten();
};

export const startWorkers = async (options: WorkersOptions): Promise<Workers> => {
  const { db } = options;
  const onError = options.onError ?? (() => undefined);
  const visibilityTimeoutMs = options.visibilityTimeoutMs ?? DEFAULTS.visibilityTimeoutMs;
  const lockRenewalMs = lockRenewalOf(options.lockRenewalMs, visibilityTimeoutMs);
  const handlers = createHandlerRegistry(options.handlers);
  const hooks = terminalFailureHooks(handlers);
  const wake = createWakeSignal();

  const recover = (): void => {
    recoverStaleJobs(db, visibilityTimeoutMs, hooks).then((recovered) => {
      if (recovered > 0) wake.notify();
    }, onError);
  };

  const unlisten = await listenForJobs(db, wake.notify).catch((error: unknown) => {
    onError(error);
    return () => Promise.resolve();
  });
  recover();
  const recovery = setInterval(recover, visibilityTimeoutMs / RECOVERIES_PER_TIMEOUT);
  const dispatcher = startDispatcher({
    execution: {
      db,
      handlers,
      retry: options.retry ?? DEFAULT_RETRY_POLICY,
      lockRenewalMs,
      onJobFailed: options.onJobFailed ?? (() => undefined),
      onJobDeferred: options.onJobDeferred ?? (() => undefined),
      onError,
    },
    concurrency: options.concurrency,
    perKindConcurrency: options.perKindConcurrency ?? {},
    pollIntervalMs: options.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
    maxPollIntervalMs: options.maxPollIntervalMs ?? DEFAULTS.maxPollIntervalMs,
    wake,
  });

  const stop = async ({
    timeoutMs = DEFAULTS.stopTimeoutMs,
    abortGraceMs = DEFAULTS.abortGraceMs,
  }: StopOptions = {}): Promise<StopReport> => {
    clearInterval(recovery);
    await dispatcher.halt();
    await unlisten().catch(onError);
    await settledWithin(dispatcher.inFlight(), timeoutMs);
    const late = dispatcher.inFlight();
    late.forEach(({ interrupt }) => {
      interrupt();
    });
    await settledWithin(late, abortGraceMs);
    const deaf = dispatcher.inFlight();
    deaf.forEach(({ abandon }) => {
      abandon();
    });
    return {
      aborted: late.map(({ job }) => job.id),
      abandoned: deaf.map(({ job }) => job.id),
    };
  };

  let stopped: Promise<StopReport> | undefined;
  return {
    stop: (stopOptions) => {
      stopped ??= stop(stopOptions);
      return stopped;
    },
  };
};
