import { describe, expect, it } from 'vitest';
import { createPageSizeReader, type PageMeasure } from './page-size.ts';

const parsePageSize = (stdout: string, page: number): PageMeasure => {
  const reader = createPageSizeReader(page);
  reader.push(Buffer.from(stdout, 'utf8'));
  return reader.measure();
};

const output = (...lines: readonly string[]): string =>
  [
    'Title:           Synthetic',
    'Pages:           3',
    ...lines,
    'File size:       700 bytes',
    '',
  ].join('\n');

describe('parsePageSize', () => {
  it('reads the longer edge of the page asked for', () => {
    expect(parsePageSize(output('Page    2 size:  595.276 x 841.89 pts (A4)'), 2)).toEqual({
      kind: 'sized',
      longEdgePt: 841.89,
    });
    expect(parsePageSize(output('Page    2 size:  9000 x 72 pts'), 2)).toEqual({
      kind: 'sized',
      longEdgePt: 9000,
    });
  });

  it('ignores the size of another page', () => {
    const stdout = output('Page    1 size:  10 x 10 pts', 'Page   12 size:  20 x 20 pts');
    expect(() => parsePageSize(stdout, 2)).toThrow(/did not report the size of page 2/);
    expect(parsePageSize(stdout, 12)).toEqual({ kind: 'sized', longEdgePt: 20 });
  });

  it.each([' ', ' ', '\r', '\u0085', '\u000b', '\u000c'])(
    'does not take %j for the start of a line',
    (separator) => {
      const forged = `Title:           x${separator}Page    1 size:  10 x 10 pts`;
      expect(parsePageSize(output(forged, 'Page    1 size:  9000 x 9000 pts'), 1)).toEqual({
        kind: 'sized',
        longEdgePt: 9000,
      });
    },
  );

  it('does not trust a size reported twice', () => {
    const stdout = output('Page    1 size:  10 x 10 pts', 'Page    1 size:  9000 x 9000 pts');
    expect(parsePageSize(stdout, 1)).toEqual({ kind: 'ambiguous' });
  });

  it('counts the size lines of the whole output, however much follows or separates them', () => {
    const padding = `PDF subtype:     ${'x'.repeat(40_000)}`;
    const real = 'Page    1 size:  144 x 72 pts';
    expect(parsePageSize(output(real, padding), 1)).toEqual({ kind: 'sized', longEdgePt: 144 });
    expect(parsePageSize(output('Page    1 size:  10 x 10 pts', padding, real), 1)).toEqual({
      kind: 'ambiguous',
    });
    expect(parsePageSize(output(real, padding, 'Page    1 size:  10 x 10 pts'), 1)).toEqual({
      kind: 'ambiguous',
    });
  });

  it('reads a size written in several chunks, and one without a final line feed', () => {
    const reader = createPageSizeReader(1);
    ['Pages: 1\nPage    1 si', 'ze:  144 x ', '72 pts'].forEach((chunk) => {
      reader.push(Buffer.from(chunk));
    });
    expect(reader.measure()).toEqual({ kind: 'sized', longEdgePt: 144 });
  });

  it('requires the whole line to be a size', () => {
    expect(() => parsePageSize(output('Page    1 size:  10 x 10 pts and more'), 1)).toThrow(
      /did not report/,
    );
    expect(() => parsePageSize(output(' Page    1 size:  10 x 10 pts'), 1)).toThrow(
      /did not report/,
    );
  });

  it.each(['0 x 0', '0 x 842', '595 x 0', '-5 x -9000', '-5 x 842'])(
    'reports a page of %s points as degenerate',
    (size) => {
      expect(parsePageSize(output(`Page    1 size:  ${size} pts`), 1)).toEqual({
        kind: 'degenerate',
      });
    },
  );

  it.each(['nan x 842', '595 x inf', 'Infinity x 842', '1e999 x 2', '0x10 x 20', 'x x y', ' x '])(
    'refuses a size of %s',
    (size) => {
      expect(() => parsePageSize(output(`Page    1 size:  ${size} pts`), 1)).toThrow(
        expect.objectContaining({ code: 'pdf_renderer_no_output', retryable: false }),
      );
    },
  );
});
