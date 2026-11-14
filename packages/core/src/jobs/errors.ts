import type { z } from 'zod';
import { StartupError } from '../domain/errors.ts';

/** Thrown by a handler to fail its job at once: another attempt cannot succeed. */
export class PermanentJobError extends Error {
  override readonly name: string = 'PermanentJobError';
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
