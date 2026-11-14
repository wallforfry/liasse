import { describe, expect, it } from 'vitest';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { ConfigError, loadConfig } from './index.ts';

const publicUrlOf = (env: Readonly<Record<string, string>>): string =>
  loadConfig({ ...SYNTHETIC_ENV, ...env }).server.publicUrl;

const problemOf = (env: Readonly<Record<string, string>>): string => {
  try {
    publicUrlOf(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error('expected the configuration to be refused');
};

describe('PUBLIC_URL', () => {
  it('defaults to the address the server listens on', () => {
    expect(publicUrlOf({ HOST: '192.0.2.7', PORT: '9000' })).toBe('http://192.0.2.7:9000');
  });

  it('brackets an IPv6 address', () => {
    expect(publicUrlOf({ HOST: '::1' })).toBe('http://[::1]:8080');
  });

  it.each(['0.0.0.0', '::'])('defaults to the loopback address when HOST is %s', (host) => {
    expect(publicUrlOf({ HOST: host })).toBe('http://127.0.0.1:8080');
  });

  it('keeps the origin of the configured URL', () => {
    expect(publicUrlOf({ PUBLIC_URL: 'https://liasse.example.com/' })).toBe(
      'https://liasse.example.com',
    );
  });

  it.each([
    'files.example.org',
    'ftp://files.example.org',
    'javascript:alert(1)',
    'https://files.example.org/base',
    'https://files.example.org/?next=1',
    'https://files.example.org/#top',
    'https://user:synthetic@files.example.org',
  ])('rejects %s without echoing it', (value) => {
    const problem = problemOf({ PUBLIC_URL: value });
    expect(problem).toContain('PUBLIC_URL: ');
    expect(problem).not.toContain(value);
  });
});
