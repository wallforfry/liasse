import { ModelProviderError } from '@liasse/core/models';
import { describe, expect, it } from 'vitest';
import { describeError } from './log.ts';

const SECRET = 'text of the document that must not leak';

const refusal = new ModelProviderError({
  provider: 'openai',
  model: 'synthetic-model',
  retryable: false,
  statusCode: 400,
  code: 'invalid_request_error:invalid_json_schema',
});

describe('describeError', () => {
  it('logs the identifiers of a provider failure', () => {
    expect(describeError(refusal)).toEqual({
      error: 'ModelProviderError',
      provider: 'openai',
      model: 'synthetic-model',
      http_status: 400,
      provider_code: 'invalid_request_error:invalid_json_schema',
    });
  });

  it('logs the class of a cause and the provider failure it is, never a message', () => {
    const wrapped = new Error(SECRET, { cause: refusal });
    const fields = describeError(wrapped);
    expect(fields).toMatchObject({
      error: 'Error',
      cause: 'ModelProviderError',
      http_status: 400,
      provider_code: 'invalid_request_error:invalid_json_schema',
    });
    expect(JSON.stringify(fields)).not.toContain(SECRET);
  });

  it('logs the class alone for any other error', () => {
    expect(describeError(new Error(SECRET))).toEqual({ error: 'Error' });
  });
});
