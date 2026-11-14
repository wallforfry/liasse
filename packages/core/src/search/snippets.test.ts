import { describe, expect, it } from 'vitest';
import { toExcerpt } from './snippets.ts';

const START = '\u{E000}';
const END = '\u{E001}';

describe('toExcerpt', () => {
  it('returns a headline without match as it is', () => {
    expect(toExcerpt('Opening words of the chunk')).toEqual({
      text: 'Opening words of the chunk',
      highlights: [],
    });
  });

  it('takes the marks out and gives the range of each match', () => {
    const excerpt = toExcerpt(`Facture d’${START}électricité${END} de ${START}mars${END} 2026`);
    expect(excerpt).toEqual({
      text: 'Facture d’électricité de mars 2026',
      highlights: [
        { start: 10, end: 21 },
        { start: 25, end: 29 },
      ],
    });
    expect(excerpt.highlights.map(({ start, end }) => excerpt.text.slice(start, end))).toEqual([
      'électricité',
      'mars',
    ]);
  });

  it('cuts the text at the bound, the highlight that straddles it included', () => {
    expect(toExcerpt(`ab ${START}cdef${END} gh ${START}ij${END}`, 5)).toEqual({
      text: 'ab cd',
      highlights: [{ start: 3, end: 5 }],
    });
    expect(toExcerpt(`ab ${START}cdef${END}`, 3)).toEqual({ text: 'ab ', highlights: [] });
  });

  it('does not cut a surrogate pair in two', () => {
    expect(toExcerpt('ab😀cd', 3).text).toBe('ab');
    expect(toExcerpt('ab😀cd', 4).text).toBe('ab😀');
  });
});
