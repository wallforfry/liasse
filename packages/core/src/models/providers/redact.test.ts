import { describe, expect, it } from 'vitest';
import { endpointSecrets, redact } from './redact.ts';

describe('endpointSecrets', () => {
  it('collects the API key, the URL password and the query values, longest first', () => {
    expect(
      endpointSecrets({
        apiKey: 'synthetic-key',
        baseUrl:
          'https://operator:synthetic-password@llm.example.com/v1?token=synthetic-long-token-01',
      }),
    ).toEqual(['synthetic-long-token-01', 'synthetic-password', 'synthetic-key']);
  });

  it('finds nothing in an endpoint without credentials', () => {
    expect(endpointSecrets({ apiKey: undefined, baseUrl: undefined })).toEqual([]);
    expect(endpointSecrets({ apiKey: undefined, baseUrl: 'http://127.0.0.1:11434' })).toEqual([]);
    expect(endpointSecrets({ apiKey: undefined, baseUrl: 'not a url' })).toEqual([]);
  });
});

describe('redact', () => {
  it('replaces every occurrence of every secret', () => {
    expect(
      redact('Bearer synthetic-key was sent to https://u:pass-01@host, key synthetic-key', [
        'synthetic-key',
        'pass-01',
      ]),
    ).toBe('Bearer [redacted] was sent to https://u:[redacted]@host, key [redacted]');
  });

  it('replaces a secret that contains another one whole', () => {
    const secrets = endpointSecrets({
      apiKey: 'synthetic',
      baseUrl: 'https://llm.example.com/v1?token=synthetic-token',
    });
    expect(redact('token synthetic-token', secrets)).toBe('token [redacted]');
  });

  it('truncates a long message after redacting it', () => {
    const message = `${'x'.repeat(295)}synthetic-key and more`;
    expect(redact(message, ['synthetic-key'])).toBe(`${'x'.repeat(295)}[reda`);
  });
});
