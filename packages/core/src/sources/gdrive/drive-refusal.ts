import { z } from 'zod';
import { DriveFileRefusedError, DriveUnauthorizedError } from './drive-api.ts';

// Drive's error body: `{ "error": { "code", "message", "errors": [{ "reason", ... }] } }`.
const errorBodySchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })).default([]) }),
});
// A reason is a camel-case code; anything else is not repeated in a message.
const REASON = /^[A-Za-z]{1,64}$/;

// Drive answers a rate limit with 429 or with 403 and one of these reasons.
const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'userRateLimitExceeded',
  'rateLimitExceeded',
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

/**
 * The reasons of a refused request. A body that is not Drive's JSON, or does not come in
 * time, gives none: the request is then refused for its status alone.
 */
export const refusalReasons = async (response: Response): Promise<readonly string[]> => {
  if (response.body === null) return [];
  try {
    const text = await new Response(
      response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
        signal: AbortSignal.timeout(ERROR_BODY_TIMEOUT_MS),
      }),
    ).text();
    const body = errorBodySchema.safeParse(JSON.parse(text));
    return body.success ? body.data.error.errors.map(({ reason }) => reason) : [];
  } catch {
    return [];
  }
};

/**
 * The error of a request Drive refused with `status`, other than 404. Only a download
 * (`perFile`) is refused for one file: the same reasons on a listing concern the source.
 */
export const refusalOf = (
  status: number,
  call: string,
  reasons: readonly string[],
  perFile: boolean,
): Error => {
  if (status === 401) {
    return new DriveUnauthorizedError('Drive refused the authorization of the source.');
  }
  const named = reasons.filter((reason) => REASON.test(reason));
  const told = named.length === 0 ? '' : ` (${named.join(', ')})`;
  if (status === 429 || named.some((reason) => RATE_LIMIT_REASONS.has(reason))) {
    return new Error(`Drive limits the rate of requests${told}: a later attempt resumes.`);
  }
  const fileRefusal = [...FILE_REFUSALS].find(([reason]) => named.includes(reason));
  if (perFile && status === 403 && fileRefusal !== undefined) {
    const [reason, message] = fileRefusal;
    return new DriveFileRefusedError(`${message} (${reason})`);
  }
  return new Error(`Drive answered ${String(status)} to ${call}${told}.`);
};
