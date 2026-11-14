import { describe, expect, it } from 'vitest';
import { downscaleRgba, fitWithin } from './scale.ts';

describe('fitWithin', () => {
  it('keeps an image that already fits', () => {
    expect(fitWithin({ width: 64, height: 48 }, 64)).toEqual({ width: 64, height: 48 });
    expect(fitWithin({ width: 64, height: 48 }, 4000)).toEqual({ width: 64, height: 48 });
  });

  it('shrinks the longer edge to the limit and keeps the proportions', () => {
    expect(fitWithin({ width: 4032, height: 3024 }, 2400)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin({ width: 3024, height: 4032 }, 2400)).toEqual({ width: 1800, height: 2400 });
  });

  it('never returns an empty edge', () => {
    expect(fitWithin({ width: 5000, height: 1 }, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe('downscaleRgba', () => {
  const pixel = (value: number): readonly number[] => [value, value, value, 255];

  it('averages the source pixels covered by each target pixel', () => {
    const source = {
      width: 4,
      height: 2,
      data: Uint8Array.from([
        ...pixel(0),
        ...pixel(100),
        ...pixel(10),
        ...pixel(30),
        ...pixel(200),
        ...pixel(100),
        ...pixel(50),
        ...pixel(110),
      ]),
    };
    const scaled = downscaleRgba(source, { width: 2, height: 1 });
    expect(scaled.width).toBe(2);
    expect(scaled.height).toBe(1);
    expect(Array.from(scaled.data)).toEqual([...pixel(100), ...pixel(50)]);
  });

  it('returns the source when the size does not change', () => {
    const source = { width: 1, height: 1, data: Uint8Array.from(pixel(7)) };
    expect(downscaleRgba(source, { width: 1, height: 1 })).toBe(source);
  });
});
