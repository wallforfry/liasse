import type { ApiErrorCode, ErrorBody } from '@liasse/contract';
import type { z } from 'zod';

/** The server refused the request, with one of the stable codes of the API. */
export class LiasseApiError extends Error {
  override readonly name = 'LiasseApiError';
  readonly status: number;
  /** Stable, for programs: one of `API_ERROR_CODES`, such as `document_not_found`. */
  readonly code: ApiErrorCode;
  /** Quote it when reporting a failure: the server logs under the same id. */
  readonly requestId: string;
  /** What the code carries besides its message, such as the `issues` of `invalid_request`. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(status: number, { error }: ErrorBody) {
    const { code, message, request_id, ...details } = error;
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = request_id;
    this.details = details;
  }
}

/**
 * The answer does not follow the contract: a proxy in between, or a server of another
 * version. `cause` holds the validation error when there was a body to validate.
 */
export class LiasseResponseError extends Error {
  override readonly name = 'LiasseResponseError';
  readonly status: number;

  constructor(status: number, message: string, cause?: z.ZodError) {
    super(message, cause === undefined ? undefined : { cause });
    this.status = status;
  }
}
