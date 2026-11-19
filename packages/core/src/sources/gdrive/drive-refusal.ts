import { z } from 'zod';
import { DriveFileRefusedError, DriveUnauthorizedError } from './drive-api.ts';

// Drive's error body: `{ "error": { "code", "message", "errors": [{ "reason", ... }] } }`.
const errorBodySchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })).default([]) }),
});
// A reason is a camel-case code; anything else is not repeated in a message.
const REASON = /^[A-Za-z]{1,64}$/;

// Limits that lift on their own: the run ends without moving its cursor, and a retry of the
// queue resumes. Drive answers a rate limit with 429 or with 403 and one of the first two
// reasons. `downloadQuotaExceeded` limits the downloads of one file for up to a day: the
// source waits for it rather than skipping, for good, a file it could read later.
const LIMIT_REASONS: ReadonlySet<string> = new Set([
  'userRateLimitExceeded',
  'rateLimitExceeded',
  'downloadQuotaExceeded',
]);

// The 403 reasons that concern the one file downloaded, never the account: the next
// attempt would meet them again. `acknowledgeAbuse` is never set, so a file Drive flagged
// as malware or spam is not served.
const FILE_REFUSALS: ReadonlyMap<string, string> = new Map([
  ['cannotDownloadAbusiveFile', 'Drive flagged the file as malware or spam and does not serve it.'],
  ['cannotDownloadFile', 'Drive does not let this account download the file.'],
  ['insufficientFilePermissions', 'This account may not download the file.'],
  ['appNotAuthorizedToFile', 'The Google client of Liasse is not authorized for the file.'],
]);

const ERROR_BODY_TIMEOUT_MS = 5_000;
// Drive's error bodies are a few hundred bytes; what is past this is not read.
const ERROR_BODY_MAX_BYTES = 64 * 1024;

// Passes the first `max` bytes, then ends the stream, which cancels the rest of the body.
const firstBytes = (max: number): TransformStream<Uint8Array, Uint8Array> => {
  let left = max;
  return new TransformStream({
    transform: (chunk, controller) => {
      controller.enqueue(chunk.subarray(0, left));
      left -= Math.min(left, chunk.byteLength);
      if (left === 0) controller.terminate();
    },
  });
};

/**
 * The reasons of a refused request. A body that is not Drive's JSON, is larger than an
 * error body, or does not come within `timeoutMs`, gives none: the request is then refused
 * for its status alone.
 */
export const refusalReasons = async (
  response: Response,
  timeoutMs = ERROR_BODY_TIMEOUT_MS,
): Promise<readonly string[]> => {
  if (response.body === null) return [];
  try {
    const text = await new Response(
      response.body.pipeThrough(firstBytes(ERROR_BODY_MAX_BYTES), {
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ).text();
    const body = errorBodySchema.safeParse(JSON.parse(text));
    return body.success ? body.data.error.errors.map(({ reason }) => reason) : [];
  } catch {
    return [];
  }
};

export interface RefusedRequest {
  readonly status: number;
  /** The resource called, as named in a message: `files`, `changes`. */
  readonly call: string;
  readonly reasons: readonly string[];
  /** The request reads the bytes of one file: only then is a refusal about that file. */
  readonly perFile: boolean;
}

/** The error of a request Drive refused, with any status but 404. */
export const refusalOf = ({ status, call, reasons, perFile }: RefusedRequest): Error => {
  if (status === 401) {
    return new DriveUnauthorizedError('Drive refused the authorization of the source.');
  }
  const named = reasons.filter((reason) => REASON.test(reason));
  const told = named.length === 0 ? '' : ` (${named.join(', ')})`;
  if (status === 429 || named.some((reason) => LIMIT_REASONS.has(reason))) {
    return new Error(`Drive limits requests or downloads for now${told}: a later attempt resumes.`);
  }
  const fileRefusal = [...FILE_REFUSALS].find(([reason]) => named.includes(reason));
  if (perFile && status === 403 && fileRefusal !== undefined) {
    const [reason, message] = fileRefusal;
    return new DriveFileRefusedError(`${message} (${reason})`);
  }
  return new Error(`Drive answered ${String(status)} to ${call}${told}.`);
};
