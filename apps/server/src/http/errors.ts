import {
  type ApiError,
  type ApiErrorKind,
  invalidRequest as invalidApiRequest,
  toApiError,
} from '@liasse/core/api';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { describeError, type Logger } from '../log.ts';
import type { AppContext } from './env.ts';

const STATUS_OF_KIND: Readonly<Record<ApiErrorKind, ContentfulStatusCode>> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  unsupported: 415,
  timeout: 504,
  unavailable: 503,
  not_implemented: 501,
};

export interface Failure {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const failure = (
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): Failure => ({ status, code, message, ...(details === undefined ? {} : { details }) });

/** Thrown by a guard or a route to answer with a failure. */
export class HttpFailure extends Error {
  override readonly name = 'HttpFailure';
  readonly failure: Failure;

  constructor(reason: Failure) {
    super(reason.message);
    this.failure = reason;
  }
}

export const respondWith = (
  context: AppContext,
  { status, code, message, details = {} }: Failure,
): Response =>
  context.json(
    // The details come first, so none of them can replace the three fields below.
    { error: { ...details, code, message, request_id: context.get('requestId') } },
    status,
  );

const ofApiError = ({ kind, code, message, details }: ApiError): Failure =>
  failure(STATUS_OF_KIND[kind], code, message, details);

export const invalidRequest = (issues: Parameters<typeof invalidApiRequest>[0]): Failure =>
  ofApiError(invalidApiRequest(issues));

// What Hono itself refuses: a body that is not JSON, a multipart body it cannot read.
const OF_HTTP_STATUS: Readonly<Partial<Record<number, Failure>>> = {
  400: failure(400, 'invalid_body', 'The request body could not be read.'),
  413: failure(413, 'body_too_large', 'The request body is too large.'),
  504: failure(504, 'request_timeout', 'The request took too long and was abandoned.'),
};

export const INTERNAL = failure(500, 'internal_error', 'The server failed to answer this request.');

/** The failure a known error answers with; the web UI shows the same ones as pages. */
export const failureOf = (error: unknown): Failure | undefined => {
  if (error instanceof HttpFailure) return error.failure;
  if (error instanceof HTTPException) return OF_HTTP_STATUS[error.status];
  const known = toApiError(error);
  return known === undefined ? undefined : ofApiError(known);
};

/**
 * Turns anything thrown into the failure body. What nobody expected becomes a 500 that
 * names the request and nothing else; its class goes to the log under the same id.
 */
export const createErrorHandler =
  (logger: Logger) =>
  (error: unknown, context: AppContext): Response => {
    const known = failureOf(error);
    if (known !== undefined) return respondWith(context, known);
    logger.event('request_failed', {
      request_id: context.get('requestId'),
      ...describeError(error),
    });
    return respondWith(context, INTERNAL);
  };

export const notFound = (context: AppContext): Response =>
  respondWith(context, failure(404, 'not_found', 'No such route.'));
