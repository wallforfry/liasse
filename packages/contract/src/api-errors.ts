import {
  isRegistryErrorCode,
  REGISTRY_ERROR_CODES,
  type RegistryErrorCode,
} from './registry/errors.ts';

// What went wrong, for a transport to map: REST turns a kind into an HTTP status, MCP
// into a JSON-RPC error. A kind says who can act on the failure, never how it is carried.
export const API_ERROR_KINDS = [
  'invalid',
  'unauthenticated',
  'forbidden',
  'not_found',
  'method_not_allowed',
  'conflict',
  'too_large',
  'unsupported',
  'rate_limited',
  'internal',
  'timeout',
  'unavailable',
  'not_implemented',
] as const;
export type ApiErrorKind = (typeof API_ERROR_KINDS)[number];

// Every code the API answers besides those of the registry, with its kind.
const KIND_OF_CODE = {
  invalid_request: 'invalid',
  invalid_body: 'invalid',
  invalid_query: 'invalid',
  invalid_correction: 'invalid',
  empty_file: 'invalid',
  document_not_settled: 'invalid',
  document_not_failed: 'invalid',
  change_already_decided: 'invalid',
  settings_not_applicable: 'invalid',
  unauthorized: 'unauthenticated',
  invalid_setup_token: 'forbidden',
  origin_refused: 'forbidden',
  not_found: 'not_found',
  document_not_found: 'not_found',
  entity_not_found: 'not_found',
  change_not_found: 'not_found',
  file_missing: 'not_found',
  method_not_allowed: 'method_not_allowed',
  settings_conflict: 'conflict',
  embedder_locked: 'conflict',
  setup_done: 'conflict',
  file_too_large: 'too_large',
  body_too_large: 'too_large',
  unsupported_format: 'unsupported',
  unsupported_media_type: 'unsupported',
  too_many_attempts: 'rate_limited',
  internal_error: 'internal',
  query_timeout: 'timeout',
  request_timeout: 'timeout',
  query_failed: 'unavailable',
  model_unavailable: 'unavailable',
  not_configured: 'unavailable',
  not_implemented: 'not_implemented',
} as const satisfies Readonly<Record<string, ApiErrorKind>>;

type OwnCode = keyof typeof KIND_OF_CODE;

const isOwnCode = (code: string): code is OwnCode => Object.hasOwn(KIND_OF_CODE, code);

/**
 * Every `code` of an error body, REST and MCP alike. It is stable: a program compares
 * against it, a person reads the message.
 */
export type ApiErrorCode = OwnCode | RegistryErrorCode;
export const API_ERROR_CODES: readonly ApiErrorCode[] = [
  ...Object.keys(KIND_OF_CODE).filter(isOwnCode),
  ...REGISTRY_ERROR_CODES,
];

/** The kind of a code. The registry refuses a request the caller has to correct. */
export const apiErrorKindOf = (code: ApiErrorCode): ApiErrorKind =>
  isRegistryErrorCode(code) ? 'invalid' : KIND_OF_CODE[code];
