import { createPrng } from '../prng.ts';
import { GLYPH_COLUMNS, GLYPH_ROWS, glyphRows } from './font.ts';

// One byte per pixel, 0 for black and 255 for white.
export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface PaperStyle {
  // Pixels per dot of the face.
  readonly scale: number;
  // Characters a line may hold and lines a sheet may hold: they set the size of the sheet.
  readonly columns: number;
  readonly rows: number;
  readonly marginPx: number;
  // The sheet lies askew by one pixel every `skew` pixels; 0 lays it straight.
  readonly skew: number;
  readonly paper: number;
  readonly ink: number;
  // Largest deviation of a pixel from its tone, as sensor grain.
  readonly noise: number;
  // How much darker the bottom right corner is than the top left one, as under a lamp.
  readonly shade: number;
  // Width of the surface visible around the sheet, 0 for a scanner that crops to it.
  readonly deskPx: number;
  readonly desk: number;
}

const LETTER_SPACING = 1;
const LINE_SPACING = 2;
const CELL_COLUMNS = GLYPH_COLUMNS + LETTER_SPACING;
const CELL_ROWS = GLYPH_ROWS + LINE_SPACING;
// Ink within the 3 by 3 neighbourhood that already makes a pixel fully dark: strokes keep
// their weight and only their edges soften.
const FULL_INK_NEIGHBOURS = 6;

export class PageOverflowError extends Error {
  override readonly name = 'PageOverflowError';
}

const sheetSize = ({ scale, columns, rows, marginPx }: PaperStyle) => ({
  width: columns * CELL_COLUMNS * scale + 2 * marginPx,
  height: rows * CELL_ROWS * scale + 2 * marginPx,
});

const assertFits = (lines: readonly string[], { columns, rows }: PaperStyle): void => {
  const longest = lines.reduce((length, line) => Math.max(length, Array.from(line).length), 0);
  if (lines.length > rows || longest > columns) {
    throw new PageOverflowError(
      `A page of ${String(lines.length)} lines, the longest of ${String(longest)} characters, does not fit a sheet of ${String(rows)} lines of ${String(columns)} characters`,
    );
  }
};

// 1 where a dot of a glyph falls, 0 elsewhere.
const inkMask = (lines: readonly string[], style: PaperStyle): Uint8Array => {
  const { scale, marginPx } = style;
  const { width, height } = sheetSize(style);
  const mask = new Uint8Array(width * height);
  lines.forEach((line, lineIndex) => {
    Array.from(line).forEach((character, column) => {
      glyphRows(character).forEach((row, rowIndex) => {
        Array.from(row).forEach((dot, dotIndex) => {
          if (dot !== '#') return;
          const left = marginPx + (column * CELL_COLUMNS + dotIndex) * scale;
          const top = marginPx + (lineIndex * CELL_ROWS + rowIndex) * scale;
          for (let y = top; y < top + scale; y += 1) {
            mask.fill(1, y * width + left, y * width + left + scale);
          }
        });
      });
    });
  });
  return mask;
};

const inkAround = (mask: Uint8Array, width: number, height: number, x: number, y: number) => {
  let ink = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) ink += mask[ny * width + nx] ?? 0;
    }
  }
  return ink;
};

// Integer arithmetic throughout, so that the pixels do not depend on the machine.
const shift = (distance: number, skew: number): number =>
  skew === 0 ? 0 : Math.trunc(distance / skew);

// Draws the lines on a sheet of paper as a scanner or a camera would return it: softened
// strokes, a sheet slightly askew, uneven light and grain. The same lines, style and seed
// give the same pixels.
export const renderPage = (
  lines: readonly string[],
  style: PaperStyle,
  seed: string,
): GrayImage => {
  assertFits(lines, style);
  const sheet = sheetSize(style);
  const mask = inkMask(lines, style);
  const width = sheet.width + 2 * style.deskPx;
  const height = sheet.height + 2 * style.deskPx;
  const random = createPrng(seed);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sheetX = x - style.deskPx + shift(y - (height >> 1), style.skew);
      const sheetY = y - style.deskPx - shift(x - (width >> 1), style.skew);
      const onSheet = sheetX >= 0 && sheetX < sheet.width && sheetY >= 0 && sheetY < sheet.height;
      const ink = onSheet
        ? Math.min(FULL_INK_NEIGHBOURS, inkAround(mask, sheet.width, sheet.height, sheetX, sheetY))
        : 0;
      const tone = onSheet
        ? style.paper - Math.round(((style.paper - style.ink) * ink) / FULL_INK_NEIGHBOURS)
        : style.desk;
      const shade = Math.trunc((style.shade * (x + y)) / (width + height));
      const grain = Math.floor(random() * (2 * style.noise + 1)) - style.noise;
      data[y * width + x] = Math.max(0, Math.min(255, tone - shade + grain));
    }
  }
  return { width, height, data };
};
