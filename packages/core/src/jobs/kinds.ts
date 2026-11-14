import type { z } from 'zod';
import type { JsonObject } from '../db/columns.ts';
import { JobPayloadError } from './errors.ts';

/**
 * A kind of job and the schema of its payload. The feature that owns a kind defines it
 * once; `enqueue` and `handle` both take it, so the queue never learns a kind by name.
 */
export interface JobKind<Payload extends JsonObject> {
  readonly name: string;
  readonly schema: z.ZodType<Payload>;
  /** Defaults to the default of `jobs.max_attempts`. */
  readonly maxAttempts?: number;
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
