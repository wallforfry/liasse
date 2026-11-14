import type { JsonObject } from '../db/columns.ts';

// What went wrong, for a transport to map: REST turns a kind into an HTTP status, MCP
// into a tool error. A kind says who can act on the failure, never how it is carried.
export const API_ERROR_KINDS = [
  'invalid',
  'not_found',
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

export const notImplemented = (feature: string): ApiError =>
  new ApiError(
    'not_implemented',
    'not_implemented',
    `This server does not provide ${feature} yet.`,
  );
