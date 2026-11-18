import { z } from 'zod';
import type { JsonObject } from '../db/columns.ts';
import { sqlStateOf } from '../db/sql-state.ts';

// What went wrong, for a transport to map: REST turns a kind into an HTTP status, MCP
// into a tool error. A kind says who can act on the failure, never how it is carried.
export const API_ERROR_KINDS = [
  'invalid',
  'forbidden',
  'not_found',
  'conflict',
  'too_large',
  'unsupported',
  'timeout',
  'unavailable',
  'not_implemented',
] as const;
export type ApiErrorKind = (typeof API_ERROR_KINDS)[number];

/**
 * A failure a caller can act on. `code` is stable and part of the contract. `message`
 * and `details` are written by Liasse alone: they never carry SQL, a file path, a
 * storage key or a stack.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly kind: ApiErrorKind;
  readonly code: string;
  readonly details: JsonObject;

  constructor(kind: ApiErrorKind, code: string, message: string, details: JsonObject = {}) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.details = details;
  }
}

export const documentNotFound = (): ApiError =>
  new ApiError('not_found', 'document_not_found', 'No document has this id.');

export const entityNotFound = (): ApiError =>
  new ApiError('not_found', 'entity_not_found', 'No entity has this id.');

export const notImplemented = (feature: string): ApiError =>
  new ApiError(
    'not_implemented',
    'not_implemented',
    `This server does not provide ${feature} yet.`,
  );

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** Only where the problem is and what Zod says of it: never the value that was sent. */
export const invalidRequest = (issues: readonly Issue[]): ApiError =>
  new ApiError('invalid', 'invalid_request', 'The request is not valid.', {
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
      'invalid',
      'invalid_request',
      'The request holds a character that cannot be stored or searched.',
    );
  }
  return undefined;
};
