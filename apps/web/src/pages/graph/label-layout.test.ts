import { describe, expect, it } from 'vitest';
import { type LabelCandidate, placedLabels, shortened } from './label-layout.ts';

const label = (id: string, x: number, y: number, forced = false): LabelCandidate => ({
  id,
  x,
  y,
  radius: 5,
  text: `Label ${id}`,
  forced,
});

describe('placedLabels', () => {
  it('keeps the first of two labels that overlap, and both once zoomed in', () => {
    const close = [label('a', 0, 0), label('b', 10, 4)];

    expect([...placedLabels(close, 1)]).toEqual(['a']);
    expect([...placedLabels(close, 20)]).toEqual(['a', 'b']);
  });

  it('places a forced label before the others, whatever its order', () => {
    expect([...placedLabels([label('a', 0, 0), label('b', 10, 4, true)], 1)]).toEqual(['b']);
  });

  it('shows every forced label, even over another', () => {
    const forced = [label('a', 0, 0, true), label('b', 10, 4, true)];

    expect([...placedLabels(forced, 1)].toSorted()).toEqual(['a', 'b']);
  });

  it('keeps labels that sit apart', () => {
    expect(placedLabels([label('a', 0, 0), label('b', 0, 200), label('c', 400, 0)], 1).size).toBe(
      3,
    );
  });

  it('measures the shortened text', () => {
    const long = 'x'.repeat(80);
    expect(shortened(long)).toHaveLength(32);
    expect(shortened('short')).toBe('short');
  });
});
