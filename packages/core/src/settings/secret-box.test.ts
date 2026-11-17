import { describe, expect, it } from 'vitest';
import { createSecretBox, SettingsSecretError } from './secret-box.ts';

const SECRET = 'synthetic-auth-secret-0123456789abcdef';
const KEY = 'synthetic-provider-key-7d1e';

describe('createSecretBox', () => {
  it('opens what it sealed, and seals the same key differently each time', () => {
    const box = createSecretBox(SECRET);
    const first = box.seal('llm', KEY);
    const second = box.seal('llm', KEY);
    expect(first).not.toBe(second);
    expect(first).not.toContain(KEY);
    expect(box.open('llm', first)).toBe(KEY);
    expect(box.open('llm', second)).toBe(KEY);
  });

  it('refuses a value sealed under another AUTH_SECRET', () => {
    const sealed = createSecretBox(SECRET).seal('llm', KEY);
    const other = createSecretBox('another-synthetic-secret-0123456789ab');
    expect(() => other.open('llm', sealed)).toThrow(SettingsSecretError);
  });

  it('refuses a value moved to another slot, or altered', () => {
    const box = createSecretBox(SECRET);
    const sealed = box.seal('llm', KEY);
    expect(() => box.open('embedding', sealed)).toThrow(SettingsSecretError);
    const [version, iv, tag, ciphertext] = sealed.split('.');
    const flipped = `${ciphertext?.startsWith('A') === true ? 'B' : 'A'}${ciphertext?.slice(1) ?? ''}`;
    expect(() => box.open('llm', [version, iv, tag, flipped].join('.'))).toThrow(
      SettingsSecretError,
    );
    expect(() => box.open('llm', 'not-sealed')).toThrow(SettingsSecretError);
  });

  it('says how to recover, and never quotes the value', () => {
    const sealed = createSecretBox(SECRET).seal('llm', KEY);
    try {
      createSecretBox('another-synthetic-secret-0123456789ab').open('llm', sealed);
    } catch (error) {
      expect(String(error)).toContain('AUTH_SECRET');
      expect(String(error)).not.toContain(sealed);
      return;
    }
    throw new Error('expected the value not to open');
  });
});
