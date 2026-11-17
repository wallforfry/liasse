import { describe, expect, it } from 'vitest';
import type { RegisteredType } from '../registry/type-store.ts';
import { appliesAutomatically, isLosslessMapping, isSafeMerge } from './policy.ts';

const type = (
  slug: string,
  fields: RegisteredType['fields'],
  status: RegisteredType['status'] = 'provisional',
): RegisteredType => ({
  id: `typ_${slug}`,
  slug,
  description: slug,
  fields,
  version: 1,
  status,
  parentSlug: null,
  aliases: [],
});

const source = type('power_bill', { meter: { type: 'identifier' }, kwh: { type: 'number' } });
const target = type('energy_bill', {
  meter_id: { type: 'identifier' },
  consumption: { type: 'number' },
});
const lossless = { meter: 'meter_id', kwh: 'consumption' };

describe('the auto-apply policy', () => {
  it.each([
    ['none', true, false],
    ['none', false, false],
    ['safe', true, true],
    ['safe', false, false],
    ['all', true, true],
    ['all', false, true],
  ] as const)('auto_apply %s applies a change safe=%s: %s', (mode, auto, expected) => {
    expect(appliesAutomatically(mode, auto)).toBe(expected);
  });

  it('calls a mapping lossless only when every field lands on one of the same definition', () => {
    expect(isLosslessMapping(source, target, lossless)).toBe(true);
    expect(isLosslessMapping(source, target, { meter: 'meter_id', kwh: null })).toBe(false);
    expect(isLosslessMapping(source, target, { meter: 'meter_id' })).toBe(false);
    expect(isLosslessMapping(source, target, { meter: 'consumption', kwh: 'meter_id' })).toBe(
      false,
    );
    expect(isLosslessMapping(source, target, { meter: 'meter_id', kwh: 'meter_id' })).toBe(false);
  });

  it('applies a merge alone only for two provisional types, lossless and sure enough', () => {
    expect(isSafeMerge(source, target, lossless, 0.9)).toBe(true);
    expect(isSafeMerge(source, target, lossless, 0.89)).toBe(false);
    expect(isSafeMerge(source, { ...target, status: 'stable' }, lossless, 0.95)).toBe(false);
    expect(isSafeMerge({ ...source, status: 'stable' }, target, lossless, 0.95)).toBe(false);
    expect(isSafeMerge(source, target, { meter: 'meter_id', kwh: null }, 0.95)).toBe(false);
  });
});
