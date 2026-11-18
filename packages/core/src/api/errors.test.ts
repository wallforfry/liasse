import { API_ERROR_CODES, apiErrorKindOf } from '@liasse/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiError,
  documentNotFound,
  entityNotFound,
  invalidRequest,
  notImplemented,
  toApiError,
} from './errors.ts';

const unstorableText = Object.assign(new Error('invalid byte sequence'), { code: '22021' });
const refusedInput = z.object({ limit: z.number() }).safeParse({ limit: 'x' }).error;

const factories: readonly (readonly [string, () => ApiError | undefined])[] = [
  ['documentNotFound', documentNotFound],
  ['entityNotFound', entityNotFound],
  ['notImplemented', () => notImplemented('synthetic feature')],
  ['invalidRequest', () => invalidRequest([{ path: ['limit'], message: 'Too big' }])],
  ['toApiError of a refused input', () => toApiError(refusedInput)],
  ['toApiError of an unstorable text', () => toApiError(unstorableText)],
];

describe('the errors of the use cases', () => {
  it.each(factories)('%s answers a code the contract lists, with its kind', (_name, make) => {
    const error = make();
    if (error === undefined) throw new Error('Expected an ApiError');
    expect(API_ERROR_CODES).toContain(error.code);
    expect(error.kind).toBe(apiErrorKindOf(error.code));
  });

  it('takes its kind from its code', () => {
    expect(new ApiError('settings_conflict', 'Stale.').kind).toBe('conflict');
    expect(new ApiError('name_taken', 'Taken.').kind).toBe('invalid');
  });

  it('leaves anything else to the transport', () => {
    expect(toApiError(new Error('unexpected'))).toBeUndefined();
  });
});
