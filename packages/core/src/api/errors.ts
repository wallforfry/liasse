import { type ApiErrorCode, type ApiErrorKind, apiErrorKindOf } from '@liasse/contract';
import { z } from 'zod';
import type { JsonObject } from '../db/columns.ts';
import { sqlStateOf } from '../db/sql-state.ts';

/**
 * A failure a caller can act on. `code` is stable and part of the contract, and decides
 * the kind. `message` and `details` are written by Liasse alone: they never carry SQL, a
 * file path, a storage key or a stack.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly kind: ApiErrorKind;
  readonly code: ApiErrorCode;
  readonly details: JsonObject;

  constructor(code: ApiErrorCode, message: string, details: JsonObject = {}) {
    super(message);
    this.kind = apiErrorKindOf(code);
    this.code = code;
    this.details = details;
  }
}

export const documentNotFound = (): ApiError =>
  new ApiError('document_not_found', 'No document has this id.');

export const entityNotFound = (): ApiError =>
  new ApiError('entity_not_found', 'No entity has this id.');

export const notImplemented = (feature: string): ApiError =>
  new ApiError('not_implemented', `This server does not provide ${feature} yet.`);

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** Only where the problem is and what Zod says of it: never the value that was sent. */
export const invalidRequest = (issues: readonly Issue[]): ApiError =>
  new ApiError('invalid_request', 'The request is not valid.', {
    issues: issues.map(({ path, message }) => ({ path: path.map(String).join('.'), message })),
  });

// SQLSTATE `character_not_in_repertoire`: a NUL character in a text parameter, which
// Postgres cannot hold. It is the caller's to fix, wherever in the request it was.
const UNSTORABLE_TEXT = '22021';

/**
 * What a transport tells its caller of a failure of a use case: an `ApiError` as it is,
 * an input a schema refused, a text Postgres cannot hold. Undefined for anything else,
 * which the transport reports as its own internal failure, without the message.
 */
export const toApiError = (error: unknown): ApiError | undefined => {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError) return invalidRequest(error.issues);
  if (sqlStateOf(error) === UNSTORABLE_TEXT) {
    return new ApiError(
      'invalid_request',
      'The request holds a character that cannot be stored or searched.',
    );
  }
  return undefined;
};
