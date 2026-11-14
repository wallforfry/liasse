import { setTimeout as delay } from 'node:timers/promises';
import { HindsightError, type HindsightOperation } from './errors.ts';

export interface RequestPolicy {
  readonly fetch: typeof fetch;
  /** Upper bound of one attempt, the reading of its response included. */
  readonly timeoutMs: number;
  /** Further attempts after a transient failure. */
  readonly retries: number;
  /** Delay before the first retry; it doubles at every further one. */
  readonly retryDelayMs: number;
}

export interface HindsightRequest<Result> {
  readonly operation: HindsightOperation;
  readonly method: 'POST' | 'DELETE';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Turns the response into a result, or throws a `HindsightError`. */
  readonly read: (response: Response) => Promise<Result>;
}

const REQUEST_TIMEOUT = 408;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERRORS = 500;

// The request did not take effect and may be sent again as it is. Every other status
// below 500 says the request itself is refused: sending it again cannot succeed.
const isTransientStatus = (status: number): boolean =>
  status === REQUEST_TIMEOUT || status === TOO_MANY_REQUESTS || status >= SERVER_ERRORS;

/** The error of a response that is not the expected success. Its body is not read. */
export const statusError = async (
  operation: HindsightOperation,
  response: Response,
): Promise<HindsightError> => {
  await response.body?.cancel();
  return new HindsightError({
    operation,
    statusCode: response.status,
    retryable: isTransientStatus(response.status),
  });
};

/** The JSON body of a success, or a `HindsightError` when it is not JSON. */
export const readJson = async (
  operation: HindsightOperation,
  response: Response,
): Promise<unknown> => {
  try {
    const body: unknown = await response.json();
    return body;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw invalidResponse(operation, response.status);
  }
};

// Not retried: Hindsight answered a success, so the request may have taken effect.
export const invalidResponse = (operation: HindsightOperation, statusCode: number) =>
  new HindsightError({ operation, statusCode, code: 'invalid_response', retryable: false });

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutError';

const transportError = (
  operation: HindsightOperation,
  error: unknown,
  signal: AbortSignal | undefined,
): HindsightError => {
  if (signal?.aborted === true) {
    return new HindsightError({ operation, code: 'aborted', retryable: true });
  }
  return new HindsightError({
    operation,
    code: isTimeout(error) ? 'timeout' : 'network',
    retryable: true,
  });
};

const attempt = async <Result>(
  policy: RequestPolicy,
  request: HindsightRequest<Result>,
  signal: AbortSignal | undefined,
): Promise<Result> => {
  const timeout = AbortSignal.timeout(policy.timeoutMs);
  try {
    const response = await policy.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      // A redirect would carry the facts to a host the operator did not name.
      redirect: 'error',
      signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
    });
    return await request.read(response);
  } catch (error) {
    throw error instanceof HindsightError
      ? error
      : transportError(request.operation, error, signal);
  }
};

const waitBeforeRetry = async (
  operation: HindsightOperation,
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> => {
  try {
    await delay(milliseconds, undefined, signal === undefined ? {} : { signal });
  } catch {
    throw new HindsightError({ operation, code: 'aborted', retryable: true });
  }
};

/**
 * Sends the request, again after a transient failure, at most `retries` more times. The
 * error of the last attempt is thrown as it is, so the caller still sees whether a
 * later try, by the job queue, can succeed.
 */
export const send = async <Result>(
  policy: RequestPolicy,
  request: HindsightRequest<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  for (let retry = 0; ; retry += 1) {
    try {
      return await attempt(policy, request, signal);
    } catch (error) {
      const transient = error instanceof HindsightError && error.retryable;
      if (!transient || retry >= policy.retries) throw error;
      // Rejects at once for a caller that aborted, so an abort is never tried again.
      await waitBeforeRetry(request.operation, policy.retryDelayMs * 2 ** retry, signal);
    }
  }
};
