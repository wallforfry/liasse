import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { jobs } from '../db/schema/jobs.ts';
import type { RegisteredHandler } from './handlers.ts';
import type { TerminalFailureHook } from './kinds.ts';

export interface ClaimedJob {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  /** 1 for the first execution. Also the fencing token of this execution. */
  readonly attempt: number;
  readonly maxAttempts: number;
}

export type JobLease = Pick<ClaimedJob, 'id' | 'attempt'>;

export const STALE_LOCK_ERROR = 'The worker stopped before the job finished';

const elapsed = (milliseconds: number) => sql`make_interval(secs => ${milliseconds / 1000})`;

export const claimJob = async (
  db: Database,
  kinds: readonly string[],
): Promise<ClaimedJob | undefined> => {
  if (kinds.length === 0) return undefined;
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'queued'),
        lte(jobs.runAfter, sql`now()`),
        inArray(jobs.kind, [...kinds]),
      ),
    )
    .orderBy(jobs.runAfter, jobs.id)
    .limit(1)
    .for('update', { skipLocked: true });
  const [claimed] = await db
    .update(jobs)
    .set({ status: 'running', lockedAt: sql`now()`, attempts: sql`${jobs.attempts} + 1` })
    .where(eq(jobs.id, sql`(${next})`))
    .returning({
      id: jobs.id,
      kind: jobs.kind,
      payload: jobs.payload,
      attempt: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
    });
  return claimed;
};

// Every claim increments `attempts`, so an execution whose lock expired and whose job
// was claimed again no longer matches: its late writes change nothing.
const heldBy = ({ id, attempt }: JobLease) =>
  and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.attempts, attempt));

const settle = async (
  db: Database,
  lease: JobLease,
  values: Parameters<ReturnType<Database['update']>['set']>[0],
): Promise<boolean> => {
  const settled = await db.update(jobs).set(values).where(heldBy(lease)).returning({ id: jobs.id });
  return settled.length > 0;
};

/** Each of these resolves to false when the lease no longer holds the job. */
export const completeJob = (db: Database, lease: JobLease): Promise<boolean> =>
  settle(db, lease, { status: 'succeeded', lockedAt: null });

export type TerminalFailureHooks = ReadonlyMap<string, TerminalFailureHook>;

/** The hooks of the kinds this process has a handler for. */
export const terminalFailureHooks = (
  handlers: ReadonlyMap<string, RegisteredHandler>,
): TerminalFailureHooks =>
  new Map(
    [...handlers.values()].flatMap(({ kind, onTerminalFailure }) =>
      onTerminalFailure === undefined ? [] : [[kind, onTerminalFailure] as const],
    ),
  );

/** Fails the job for good and, in the same transaction, runs the hook of its kind. */
export const failJob = (
  db: Database,
  job: JobLease & Pick<ClaimedJob, 'kind' | 'payload'>,
  lastError: string,
  hook: TerminalFailureHook | undefined,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    const settled = await tx
      .update(jobs)
      .set({ status: 'failed', lockedAt: null, lastError })
      .where(heldBy(job))
      .returning({ id: jobs.id });
    if (settled.length === 0) return false;
    await hook?.(tx, { jobId: job.id, payload: job.payload, cause: 'error' });
    return true;
  });

export const retryJob = (
  db: Database,
  lease: JobLease,
  lastError: string,
  delayMs: number,
): Promise<boolean> =>
  settle(db, lease, {
    status: 'queued',
    lockedAt: null,
    lastError,
    runAfter: sql`now() + ${elapsed(delayMs)}`,
  });

/** Gives an interrupted job back without counting the attempt. */
export const releaseJob = (db: Database, lease: JobLease): Promise<boolean> =>
  settle(db, lease, {
    status: 'queued',
    lockedAt: null,
    attempts: sql`${jobs.attempts} - 1`,
  });

/** Runs the job again after `delayMs`, without counting the attempt. */
export const deferJob = (db: Database, lease: JobLease, delayMs: number): Promise<boolean> =>
  settle(db, lease, {
    status: 'queued',
    lockedAt: null,
    attempts: sql`${jobs.attempts} - 1`,
    runAfter: sql`now() + ${elapsed(delayMs)}`,
  });

export const renewJobLock = (db: Database, lease: JobLease): Promise<boolean> =>
  settle(db, lease, { lockedAt: sql`now()` });

/**
 * Requeues the running jobs whose lock was not renewed for `visibilityTimeoutMs`, and
 * fails those that already used every attempt, running the hook of the kind of each in
 * the same transaction. A kind without a hook here (no handler in this process) is failed
 * all the same. Returns how many jobs it touched.
 */
export const recoverStaleJobs = (
  db: Database,
  visibilityTimeoutMs: number,
  hooks: TerminalFailureHooks = new Map(),
): Promise<number> =>
  db.transaction(async (tx) => {
    const recovered = await tx
      .update(jobs)
      .set({
        status: sql`CASE WHEN ${jobs.attempts} >= ${jobs.maxAttempts}
          THEN 'failed'::job_status ELSE 'queued'::job_status END`,
        lockedAt: null,
        lastError: STALE_LOCK_ERROR,
      })
      .where(
        and(
          eq(jobs.status, 'running'),
          lt(jobs.lockedAt, sql`now() - ${elapsed(visibilityTimeoutMs)}`),
        ),
      )
      .returning({ id: jobs.id, kind: jobs.kind, payload: jobs.payload, status: jobs.status });
    for (const { id, kind, payload, status } of recovered) {
      if (status === 'failed') await hooks.get(kind)?.(tx, { jobId: id, payload, cause: 'stale' });
    }
    return recovered.length;
  });
