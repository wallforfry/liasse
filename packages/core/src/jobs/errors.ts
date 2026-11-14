import type { z } from 'zod';
import { StartupError } from '../domain/errors.ts';

/** Thrown by a handler to fail its job at once: another attempt cannot succeed. */
export class PermanentJobError extends Error {
  override readonly name: string = 'PermanentJobError';
}

export interface DeferJobOptions {
  /** The first delay of the retry policy when left out. */
  readonly delayMs?: number;
  /** The error that keeps the job from running now. */
  readonly cause?: unknown;
}

/**
 * Thrown by a handler whose job cannot run yet, for a reason that is not a failure of
 * the job: a resource another job holds, a state that settles on its own. The job runs
 * again after the delay and the attempt is not counted. The condition must end by
 * itself: a job that keeps deferring is never failed by the queue.
 */
export class DeferJobError extends Error {
  override readonly name: string = 'DeferJobError';
  readonly delayMs: number | undefined;

  constructor(message: string, { delayMs, cause }: DeferJobOptions = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.delayMs = delayMs;
  }
}

// Only paths and Zod's messages are kept: a payload may carry document content.
export class JobPayloadError extends PermanentJobError {
  override readonly name = 'JobPayloadError';

  constructor(kind: string, issues: readonly z.core.$ZodIssue[]) {
    const problems = issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
    super(`The payload of a ${kind} job does not match its schema (${problems.join('; ')})`);
  }
}

export class DuplicateJobHandlerError extends StartupError {
  override readonly name = 'DuplicateJobHandlerError';

  constructor(kind: string) {
    super(`Two handlers are registered for the job kind ${kind}`);
  }
}

export class InvalidWorkersOptionsError extends StartupError {
  override readonly name = 'InvalidWorkersOptionsError';
}

/** Abort reason given to a handler still running when `stop()` reaches its deadline. */
export class WorkersStoppingError extends Error {
  override readonly name = 'WorkersStoppingError';

  constructor() {
    super('The workers are stopping');
  }
}

/** Abort reason given to a handler whose job was taken over after its lock expired. */
export class JobLockLostError extends Error {
  override readonly name = 'JobLockLostError';

  constructor() {
    super('The lock of the job expired and the job was taken over');
  }
}
