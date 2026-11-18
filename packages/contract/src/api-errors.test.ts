import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, API_ERROR_KINDS, apiErrorKindOf } from './api-errors.ts';
import { REGISTRY_ERROR_CODES } from './registry/errors.ts';
import { errorBodySchema } from './system.ts';

const bodyWith = (code: string) => ({
  error: { code, message: 'Refused.', request_id: 'req_synthetic' },
});

describe('the error codes of the API', () => {
  it('lists each code once, the codes of the registry included', () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining([...REGISTRY_ERROR_CODES]));
  });

  it('gives every code a kind', () => {
    expect(
      API_ERROR_CODES.filter((code) => !API_ERROR_KINDS.includes(apiErrorKindOf(code))),
    ).toEqual([]);
    expect(REGISTRY_ERROR_CODES.map(apiErrorKindOf)).toEqual(
      REGISTRY_ERROR_CODES.map(() => 'invalid'),
    );
    expect(apiErrorKindOf('document_not_found')).toBe('not_found');
  });

  it('is the only set of codes an error body takes', () => {
    expect(
      API_ERROR_CODES.filter((code) => !errorBodySchema.safeParse(bodyWith(code)).success),
    ).toEqual([]);
    expect(errorBodySchema.safeParse(bodyWith('unlisted_code')).success).toBe(false);
    expect(errorBodySchema.safeParse(bodyWith('constructor')).success).toBe(false);
  });
});
