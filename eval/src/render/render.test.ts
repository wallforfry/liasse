import { inflateSync } from 'node:zlib';
import { decode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { SCENARIO } from '../scenario/index.ts';
import { GLYPH_COLUMNS, GLYPH_ROWS, glyphRows, MissingGlyphError } from './font.ts';
import { GLYPHS } from './glyphs.ts';
import { encodeJpeg } from './jpeg.ts';
import { PAPERS, paperStyle } from './paper.ts';
import { encodeBilevelPng } from './png.ts';
import { PageOverflowError, renderPage } from './raster.ts';

const darkPixels = ({ data }: { readonly data: Uint8Array }): number =>
  data.filter((tone) => tone < 128).length;

describe('the corpus face', () => {
  it('draws every glyph on the same grid', () => {
    const misdrawn = Object.entries(GLYPHS).filter(([, rows]) => {
      const lines = rows.split(' ');
      return ![7, 8, 9].includes(lines.length) || lines.some((line) => !/^[.#]{5}$/.test(line));
    });
    expect(misdrawn.map(([character]) => character)).toEqual([]);
  });

  it.each(['A', 'g', 'é', 'É', 'ç', 'ï', 'ñ', 'Ü', '€'])(
    'gives %s eleven rows of five dots',
    (character) => {
      const rows = glyphRows(character);
      expect(rows).toHaveLength(GLYPH_ROWS);
      expect(rows.every((row) => row.length === GLYPH_COLUMNS)).toBe(true);
    },
  );

  it('sets the accent of a small letter above it and keeps the letter', () => {
    expect(glyphRows('é').slice(4)).toEqual(glyphRows('e').slice(4));
    expect(glyphRows('é').slice(2, 4)).not.toEqual(glyphRows('e').slice(2, 4));
  });

  it('sets the accent of a capital above the capital, which stays whole', () => {
    expect(glyphRows('É').slice(2)).toEqual(glyphRows('E').slice(2));
    expect(glyphRows('É').slice(0, 2)).not.toEqual(glyphRows('E').slice(0, 2));
  });

  it('takes the dot off an accented i', () => {
    expect(glyphRows('ï').slice(2, 4)).toEqual(['.#.#.', '.....']);
    expect(glyphRows('ï').slice(4)).toEqual(glyphRows('i').slice(4));
  });

  it('hangs the cedilla below the letter', () => {
    expect(glyphRows('ç').slice(0, 9)).toEqual(glyphRows('c').slice(0, 9));
    expect(glyphRows('ç').slice(9)).not.toEqual(glyphRows('c').slice(9));
  });

  it('refuses a character it cannot draw', () => {
    expect(() => glyphRows('中')).toThrow(MissingGlyphError);
    expect(() => glyphRows('ǎ')).toThrow(MissingGlyphError);
  });

  it('can draw every character of every page the scenario rasterises', () => {
    const drawn = SCENARIO.flatMap(({ render }) => {
      if (render.kind === 'image') return render.lines;
      return render.kind === 'pdf'
        ? render.pages.flatMap(({ lines, scan }) => (scan === undefined ? [] : lines))
        : [];
    });
    const characters = [...new Set(drawn.flatMap((line) => Array.from(line)))];
    expect(characters.length).toBeGreaterThan(80);
    expect(characters.filter((character) => glyphRows(character).length !== GLYPH_ROWS)).toEqual(
      [],
    );
  });
});

describe('renderPage', () => {
  const style = paperStyle('scan', 3);
  const lines = ['Total TTC : 61,15 €', 'À payer avant le 23 avril 2025'];

  it('gives the same pixels for the same lines, paper and seed', () => {
    expect(renderPage(lines, style, 'seed').data).toEqual(renderPage(lines, style, 'seed').data);
  });

  it('gives another grain for another seed, and more ink for more text', () => {
    const page = renderPage(lines, style, 'seed');
    expect(renderPage(lines, style, 'other').data).not.toEqual(page.data);
    expect(
      darkPixels(renderPage([...lines, ...lines], paperStyle('scan', 4), 'seed')),
    ).toBeGreaterThan(darkPixels(page) * 1.8);
  });

  it('leaves an empty sheet without a dark pixel', () => {
    expect(darkPixels(renderPage([], style, 'seed'))).toBe(0);
  });

  it('sizes the sheet from its columns and rows, and adds the desk around a photo', () => {
    const scan = renderPage([], paperStyle('scan', 0), 'seed');
    const photo = renderPage([], paperStyle('photo', 0), 'seed');
    expect([scan.width, scan.height]).toEqual([76 * 6 * 2 + 96, 50 * 13 * 2 + 96]);
    expect(photo.width).toBe(76 * 6 * 2 + 2 * PAPERS.photo.marginPx + 2 * PAPERS.photo.deskPx);
  });

  it('refuses a line or a page that does not fit the sheet', () => {
    expect(() => renderPage(['x'.repeat(77)], style, 'seed')).toThrow(PageOverflowError);
    expect(() =>
      renderPage(
        Array.from({ length: 52 }, () => 'x'),
        style,
        'seed',
      ),
    ).toThrow(PageOverflowError);
  });
});

describe('the encoders', () => {
  const page = renderPage(['PARKING', '4,50 EUR'], paperStyle('screen', 2), 'seed');

  it('write a JPEG a decoder reads back at the same size and nearly the same tones', () => {
    const decoded = decode(encodeJpeg(page, 90), { useTArray: true });
    expect([decoded.width, decoded.height]).toEqual([page.width, page.height]);
    const difference =
      page.data.reduce(
        (total, tone, pixel) => total + Math.abs(tone - (decoded.data[pixel * 4] ?? 0)),
        0,
      ) / page.data.length;
    expect(difference).toBeLessThan(4);
  });

  it('write a black and white PNG whose pixels are the page', () => {
    const png = Buffer.from(encodeBilevelPng(page));
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([page.width, page.height]);
    const length = png.readUInt32BE(33);
    const scanlines = inflateSync(png.subarray(41, 41 + length));
    const stride = 1 + Math.ceil(page.width / 8);
    expect(scanlines).toHaveLength(stride * page.height);
    const white = (x: number, y: number): boolean =>
      ((scanlines[y * stride + 1 + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0;
    const mismatched = page.data.filter((tone, pixel) => {
      const [x, y] = [pixel % page.width, Math.floor(pixel / page.width)];
      return tone >= 128 !== white(x, y);
    });
    expect(mismatched).toHaveLength(0);
  });
});
