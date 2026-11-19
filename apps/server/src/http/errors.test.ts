import { API_ERROR_CODES, type ApiErrorCode } from '@liasse/contract';
import { describe, expect, it } from 'vitest';
import { failure } from './errors.ts';

// The HTTP status of each code, as the REST API promises it: written here, not derived, so
// a change of kind in the contract fails this test.
const STATUS_OF_CODE: Readonly<Record<ApiErrorCode, number>> = {
  invalid_request: 400,
  invalid_body: 400,
  invalid_query: 400,
  invalid_correction: 400,
  empty_file: 400,
  document_not_settled: 400,
  document_not_failed: 400,
  change_already_decided: 400,
  settings_not_applicable: 400,
  source_secret_required: 400,
  source_kind_mismatch: 400,
  invalid_slug: 400,
  invalid_alias: 400,
  invalid_fields: 400,
  name_taken: 400,
  primitive_conflict: 400,
  field_exists: 400,
  field_not_found: 400,
  field_unchanged: 400,
  invalid_description: 400,
  parent_not_found: 400,
  hierarchy_too_deep: 400,
  type_not_found: 400,
  type_merged: 400,
  invalid_status: 400,
  invalid_merge: 400,
  unauthorized: 401,
  invalid_setup_token: 403,
  origin_refused: 403,
  not_found: 404,
  document_not_found: 404,
  entity_not_found: 404,
  change_not_found: 404,
  source_not_found: 404,
  file_missing: 404,
  file_unavailable: 410,
  method_not_allowed: 405,
  settings_conflict: 409,
  embedder_locked: 409,
  setup_done: 409,
  source_disabled: 409,
  source_needs_attention: 409,
  file_changed: 409,
  google_client_missing: 409,
  file_too_large: 413,
  body_too_large: 413,
  unsupported_format: 415,
  unsupported_media_type: 415,
  too_many_attempts: 429,
  internal_error: 500,
  not_implemented: 501,
  query_failed: 503,
  model_unavailable: 503,
  not_configured: 503,
  query_timeout: 504,
  request_timeout: 504,
};

describe('the status of a failure', () => {
  it('is the one the REST API promises for its code, for every code', () => {
    expect(
      Object.fromEntries(API_ERROR_CODES.map((code) => [code, failure(code, '').status])),
    ).toEqual(STATUS_OF_CODE);
  });
});
