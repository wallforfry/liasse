import { describe, expect, it } from 'vitest';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { loadConfig } from './index.ts';

// 'synthetic-salt-1' and 'synthetic-hash-0123456789abcdef', base64 without padding.
const SALT = 'c3ludGhldGljLXNhbHQtMQ';
const HASH = 'c3ludGhldGljLWhhc2gtMDEyMzQ1Njc4OWFiY2RlZg';
const phc = (parameters: string, version = '19', salt = SALT): string =>
  `$argon2id$v=${version}$${parameters}$${salt}$${HASH}`;

const uiOf = (password: string) => loadConfig({ ...SYNTHETIC_ENV, UI_PASSWORD: password }).auth.ui;

describe('UI_PASSWORD', () => {
  it('reads an argon2id hash in PHC form', () => {
    expect(uiOf(phc('m=19456,t=2,p=1'))?.password).toEqual({
      kind: 'argon2id',
      memorySize: 19_456,
      iterations: 2,
      parallelism: 1,
      salt: new Uint8Array(Buffer.from('synthetic-salt-1')),
      hash: new Uint8Array(Buffer.from('synthetic-hash-0123456789abcdef')),
    });
  });

  it.each([
    ['another variant', `$argon2i$v=19$m=19456,t=2,p=1$${SALT}$${HASH}`],
    ['another version', phc('m=19456,t=2,p=1', '16')],
    ['a cost above the bounds', phc('m=2097152,t=2,p=1')],
    ['no pass', phc('m=19456,t=0,p=1')],
    ['a short salt', phc('m=19456,t=2,p=1', '19', 'c2FsdA')],
    ['a truncated string', '$argon2id$v=19$m=19456,t=2,p=1'],
  ])('refuses a hash with %s, without quoting it', (_case, value) => {
    expect(() => uiOf(value)).toThrow(/UI_PASSWORD: a value starting with \$argon2/);
    expect(() => uiOf(value)).not.toThrow(SALT);
  });

  it('keeps any other value as a plain password', () => {
    expect(uiOf('argon2id-is-not-a-prefix')?.password).toEqual({
      kind: 'plain',
      value: 'argon2id-is-not-a-prefix',
    });
  });
});
