import { describe, expect, it } from 'vitest';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { loadConfig } from './index.ts';

describe('loadConfig value parsing', () => {
  it.each(['0x10', '1e3', ' ', ' 5', '5 ', '05', '+5', '-5', '5.0', '5,0', 'five'])(
    'rejects the integer %j',
    (value) => {
      expect(() => loadConfig({ ...SYNTHETIC_ENV, MAX_NEW_TYPES_PER_DAY: value })).toThrow(
        /^Invalid configuration:\n {2}- MAX_NEW_TYPES_PER_DAY: expected a decimal integer such as 42$/,
      );
    },
  );

  it.each([
    ['0', 0],
    ['7', 7],
    ['1000', 1000],
  ])('accepts the integer %j', (value, expected) => {
    expect(
      loadConfig({ ...SYNTHETIC_ENV, MAX_NEW_TYPES_PER_DAY: value }).pipeline.maxNewTypesPerDay,
    ).toBe(expected);
  });

  it.each(['0x0', '1e-1', ' ', ' 0.5', '0.5 ', '.5', '5.', '+0.5', '0,5', 'half'])(
    'rejects the decimal %j',
    (value) => {
      expect(() => loadConfig({ ...SYNTHETIC_ENV, CONFIDENCE_THRESHOLD: value })).toThrow(
        /^Invalid configuration:\n {2}- CONFIDENCE_THRESHOLD: expected a decimal number such as 0\.7$/,
      );
    },
  );

  it.each([
    ['0', 0],
    ['1', 1],
    ['0.55', 0.55],
  ])('accepts the decimal %j', (value, expected) => {
    expect(
      loadConfig({ ...SYNTHETIC_ENV, CONFIDENCE_THRESHOLD: value }).pipeline.confidenceThreshold,
    ).toBe(expected);
  });

  it.each(['en', 'fr', 'de', 'es', 'it'])('accepts the schema language %s', (language) => {
    expect(
      loadConfig({ ...SYNTHETIC_ENV, SCHEMA_LANGUAGE: language }).pipeline.schemaLanguage,
    ).toBe(language);
  });

  it.each(['pt', 'EN', 'eng', 'english'])(
    'rejects the schema language %j, which has no naming table',
    (language) => {
      expect(() => loadConfig({ ...SYNTHETIC_ENV, SCHEMA_LANGUAGE: language })).toThrow(
        /^Invalid configuration:\n {2}- SCHEMA_LANGUAGE: /,
      );
    },
  );

  it('rejects a number outside its range', () => {
    expect(() => loadConfig({ ...SYNTHETIC_ENV, PORT: '70000', WORKERS: '0' })).toThrow(
      /PORT: Too big.*\n.*WORKERS: Too small/,
    );
  });

  it('keeps the bootstrap password exactly as given', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      AUTH_BOOTSTRAP_EMAIL: 'owner@example.com',
      AUTH_BOOTSTRAP_PASSWORD: '  padded password ',
    });
    expect(config.auth.bootstrap?.password).toBe('  padded password ');
  });

  it('treats empty variables as unset', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      PORT: '',
      WATCH_DIR: '',
      AUTH_BOOTSTRAP_EMAIL: '',
      AUTH_BOOTSTRAP_PASSWORD: '',
    });
    expect(config.server.port).toBe(8080);
    expect(config.pipeline.watchDir).toBeUndefined();
    expect(config.auth.bootstrap).toBeUndefined();
  });
});
