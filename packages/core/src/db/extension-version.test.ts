import { describe, expect, it } from 'vitest';
import { isVersionAtLeast } from './extension-version.ts';

describe('isVersionAtLeast', () => {
  it.each([
    ['0.26.0', true],
    ['0.26.6', true],
    ['0.27', true],
    ['1.0.0', true],
    ['0.26', true],
    ['0.25.9', false],
    ['0.9.0', false],
    ['0.26.0-beta', false],
    ['', false],
  ])('compares %j with 0.26.0', (version, expected) => {
    expect(isVersionAtLeast(version, [0, 26, 0])).toBe(expected);
  });
});
