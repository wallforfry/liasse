import { describe, expect, it } from 'vitest';
import { fittedTo, transformOf, zoomedAt } from './use-pan-zoom.ts';

describe('zoomedAt', () => {
  it('keeps the point under the cursor where it was', () => {
    const viewport = { x: 10, y: -20, scale: 1.5 };
    const point = { x: 40, y: 60 };
    const zoomed = zoomedAt(viewport, point, 2);
    const contentX = (point.x - viewport.x) / viewport.scale;
    const contentY = (point.y - viewport.y) / viewport.scale;
    expect(zoomed.scale).toBe(3);
    expect(zoomed.x + contentX * zoomed.scale).toBeCloseTo(point.x);
    expect(zoomed.y + contentY * zoomed.scale).toBeCloseTo(point.y);
  });

  it('bounds the scale', () => {
    expect(zoomedAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 1000).scale).toBe(8);
    expect(zoomedAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0.001).scale).toBe(0.2);
  });

  it('writes the transform as an SVG attribute', () => {
    expect(transformOf({ x: 1, y: 2, scale: 3 })).toBe('translate(1 2) scale(3)');
  });
});

describe('fittedTo', () => {
  it('shows the content whole and centred in the view box', () => {
    const viewBox = { x: -100, y: -50, width: 200, height: 100 };
    const fitted = fittedTo(viewBox, { x: 0, y: 0, width: 400, height: 100 });
    expect(fitted.scale).toBe(0.5);
    expect(fitted.x).toBe(-100);
    expect(fitted.y).toBe(-25);
  });
});
