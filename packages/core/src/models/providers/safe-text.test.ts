import { describe, expect, it } from 'vitest';
import { providerErrorCode } from './safe-text.ts';

describe('providerErrorCode', () => {
  it.each([
    [
      'OpenAI, a schema it refuses',
      { error: { message: 'x', type: 'invalid_request_error', code: 'invalid_json_schema' } },
      'invalid_request_error:invalid_json_schema',
    ],
    [
      'OpenAI, a prompt that is too long',
      { error: { type: 'invalid_request_error', code: 'context_length_exceeded', param: null } },
      'invalid_request_error:context_length_exceeded',
    ],
    [
      'OpenAI, an unknown model',
      { error: { type: 'invalid_request_error', code: 'model_not_found' } },
      'invalid_request_error:model_not_found',
    ],
    ['a null code', { error: { type: 'server_error', code: null } }, 'server_error'],
    ['a code alone', { error: { code: 'rate_limit_exceeded' } }, 'rate_limit_exceeded'],
    [
      'a code that repeats the type',
      { error: { type: 'overloaded_error', code: 'overloaded_error' } },
      'overloaded_error',
    ],
    [
      'Anthropic',
      { type: 'error', error: { type: 'overloaded_error', message: 'x' } },
      'overloaded_error',
    ],
    [
      'Google',
      { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'x' } },
      'INVALID_ARGUMENT',
    ],
    ['a numeric code that is not the HTTP status', { error: { code: 3051 } }, '3051'],
    [
      'fields at the top of the body',
      { type: 'invalid_request', code: 'bad_model' },
      'invalid_request:bad_model',
    ],
  ])('reads %s', (_case, body, expected) => {
    expect(providerErrorCode(body, 400)).toBe(expected);
  });

  it.each([
    ['no body', undefined],
    ['a body that is not an object', 'model not found'],
    ['an error that is a sentence', { error: 'model not found' }],
    ['free text in every field', { error: { type: 'not an identifier', code: 'nor this one' } }],
    ['a code that only repeats the HTTP status', { error: { code: 400 } }],
  ])('finds nothing in %s', (_case, body) => {
    expect(providerErrorCode(body, 400)).toBeUndefined();
  });
});
