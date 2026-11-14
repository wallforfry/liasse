import { describe, expect, it } from 'vitest';
import { describeJobError, MAX_LAST_ERROR_LENGTH } from './last-error.ts';

describe('describeJobError', () => {
  it('keeps the name and the message, never the stack or the cause', () => {
    const error = new TypeError('synthetic message', { cause: new Error('synthetic cause') });
    expect(describeJobError(error)).toBe('TypeError: synthetic message');
  });

  it('truncates a long message', () => {
    const described = describeJobError(new Error('x'.repeat(5000)));
    expect(described).toHaveLength(MAX_LAST_ERROR_LENGTH);
    expect(described.startsWith('Error: xxx')).toBe(true);
  });

  it('does not render a thrown value that is not an error', () => {
    expect(describeJobError({ token: 'synthetic-thrown-secret' })).toBe('Non-error thrown');
    expect(describeJobError('synthetic-thrown-secret')).toBe('Non-error thrown');
  });

  it.each([
    ['URL credentials', 'connect to postgres://liasse:synthetic-s3cret@db:5432/liasse failed'],
    ['a bearer token', 'request failed with Authorization: Bearer synthetic-s3cret'],
    ['an API key assignment', 'provider refused api_key=synthetic-s3cret&model=x'],
    ['a JSON token field', 'body was {"token": "synthetic-s3cret"}'],
    ['a password assignment', 'login failed (password: synthetic-s3cret)'],
  ])('masks %s', (_label, message) => {
    const described = describeJobError(new Error(message));
    expect(described).not.toContain('synthetic-s3cret');
    expect(described).toContain('[redacted]');
  });

  it('leaves an ordinary message as it is', () => {
    expect(describeJobError(new Error('page 3 of doc_01 has no text layer'))).toBe(
      'Error: page 3 of doc_01 has no text layer',
    );
  });
});
