import type { z } from 'zod';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { JobPayloadError } from './errors.ts';

export type JobTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * How a job reached `failed` for good: its handler failed at the last attempt (or with a
 * permanent error, or before it ran, on a payload that does not match), or the job was
 * still `running` without a lock renewal when its attempts were spent.
 */
export type TerminalFailureCause = 'error' | 'stale';

export interface TerminalFailure {
  readonly jobId: string;
  /** As stored: it may not match the schema of the kind. */
  readonly payload: unknown;
  readonly cause: TerminalFailureCause;
}

/**
 * Runs in the transaction that fails the job: when it throws, the job is not failed and
 * the recovery of stale locks finds it again later.
 */
export type TerminalFailureHook = (tx: JobTransaction, failure: TerminalFailure) => Promise<void>;

/**
 * A kind of job and the schema of its payload. The feature that owns a kind defines it
 * once; `enqueue` and `handle` both take it, so the queue never learns a kind by name.
 */
export interface JobKind<Payload extends JsonObject> {
  readonly name: string;
  readonly schema: z.ZodType<Payload>;
  /** Defaults to the default of `jobs.max_attempts`. */
  readonly maxAttempts?: number;
  /** What the failure of the job for good means for what it was working on. */
  readonly onTerminalFailure?: TerminalFailureHook;
}

export const defineJobKind = <Payload extends JsonObject>(
  kind: JobKind<Payload>,
): JobKind<Payload> => Object.freeze({ ...kind });

export const parseJobPayload = <Payload extends JsonObject>(
  kind: JobKind<Payload>,
  payload: unknown,
): Payload => {
  const result = kind.schema.safeParse(payload);
  if (!result.success) throw new JobPayloadError(kind.name, result.error.issues);
  return result.data;
};
