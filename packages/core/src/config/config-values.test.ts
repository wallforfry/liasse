import { describe, expect, it } from 'vitest';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { loadConfig } from './index.ts';

describe('loadConfig value parsing', () => {
  it.each(['0x10', '1e3', ' ', ' 5', '5 ', '05', '+5', '-5', '5.0', '5,0', 'five'])(
    'rejects the integer %j',
    (value) => {
      expect(() => loadConfig({ ...SYNTHETIC_ENV, WORKERS: value })).toThrow(
        /^Invalid configuration:\n {2}- WORKERS: expected a decimal integer such as 42$/,
      );
    },
  );

  it.each([
    ['1', 1],
    ['7', 7],
    ['64', 64],
  ])('accepts the integer %j', (value, expected) => {
    expect(loadConfig({ ...SYNTHETIC_ENV, WORKERS: value }).resources.workers).toBe(expected);
  });

  it('rejects a number outside its range', () => {
    expect(() => loadConfig({ ...SYNTHETIC_ENV, PORT: '70000', WORKERS: '0' })).toThrow(
      /PORT: Too big.*\n.*WORKERS: Too small/,
    );
  });

  it('treats empty variables as unset, a variable of the settings included', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      PORT: '',
      WATCH_DIR: '',
      LLM_PROVIDER: '',
      AUTH_BOOTSTRAP_EMAIL: '',
    });
    expect(config.server.port).toBe(8080);
    expect(config.resources.watchDir).toBeUndefined();
  });
});
