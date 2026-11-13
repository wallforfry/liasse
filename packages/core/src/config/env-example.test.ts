import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG_ENV_KEYS, loadConfig } from './index.ts';

describe('.env.example', () => {
  const example = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');
  const documentedKeys = new Set(
    example
      .split('\n')
      .map((line) => /^(?:# )?([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((key) => key !== undefined),
  );

  it('documents every variable of the schema', () => {
    expect(CONFIG_ENV_KEYS.filter((key) => !documentedKeys.has(key))).toEqual([]);
  });

  it('documents no variable the schema ignores', () => {
    expect([...documentedKeys].filter((key) => !CONFIG_ENV_KEYS.includes(key))).toEqual([]);
  });

  it('loads once its uncommented values are applied', () => {
    const env = Object.fromEntries(
      example
        .split('\n')
        .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    expect(loadConfig(env).database.url).toBe('postgres://liasse:liasse@127.0.0.1:54329/liasse');
  });
});
