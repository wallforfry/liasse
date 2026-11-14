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

interface Mask {
  readonly width: number;
  readonly height: number;
  // 1 where ink falls, 0 elsewhere.
  readonly data: Uint8Array;
}

interface Pen {
  readonly left: number;
  readonly top: number;
  readonly scale: number;
  // Extra pixels given to each dot: 0 for the regular weight, 1 for the bold one.
  readonly weight: number;
}

const HEADING_MIN_LETTERS = 8;

// A line set in capitals is a title or a letterhead: it is drawn in the bold weight.
const isHeading = (line: string): boolean =>
  line === line.toUpperCase() && (line.match(/\p{L}/gu)?.length ?? 0) >= HEADING_MIN_LETTERS;

const drawLine = (mask: Mask, line: string, { left, top, scale, weight }: Pen): void => {
  Array.from(line).forEach((character, column) => {
    glyphRows(character).forEach((row, rowIndex) => {
      Array.from(row).forEach((dot, dotIndex) => {
        if (dot !== '#') return;
        const x = left + (column * CELL_COLUMNS + dotIndex) * scale;
        const y = top + rowIndex * scale;
        for (let dy = 0; dy < scale; dy += 1) {
          mask.data.fill(1, (y + dy) * mask.width + x, (y + dy) * mask.width + x + scale + weight);
        }
      });
    });
  });
};

const inkMask = (lines: readonly string[], style: PaperStyle): Mask => {
  const { scale, marginPx } = style;
  const { width, height } = sheetSize(style);
  const mask = { width, height, data: new Uint8Array(width * height) };
  lines.forEach((line, lineIndex) => {
    drawLine(mask, line, {
      left: marginPx,
      top: marginPx + lineIndex * CELL_ROWS * scale,
      scale,
      weight: isHeading(line) ? 1 : 0,
    });
  });
  return mask;
};

// The grey of a rubber stamp: lighter than print, darker than paper.
const STAMP_TONE = 118;
// The stamp is pressed askew by one pixel every six, about ten degrees.
const STAMP_SKEW = 6;
// How far down the sheet the stamp sits, in hundredths of its height.
const STAMP_HEIGHT_PERCENT = 62;

interface Stamp extends Mask {
  readonly left: number;
  readonly top: number;
}

// The words in a frame, one size above the print, placed in the lower right of the sheet.
const stampOf = (text: string, style: PaperStyle): Stamp => {
  const scale = style.scale + 1;
  const padding = 4 * scale;
  const width = Array.from(text).length * CELL_COLUMNS * scale + 2 * padding;
  const height = GLYPH_ROWS * scale + 2 * padding;
  const data = new Uint8Array(width * height).map((_, pixel) => {
    const [x, y] = [pixel % width, Math.floor(pixel / width)];
    return x < scale || y < scale || x >= width - scale || y >= height - scale ? 1 : 0;
  });
  const stamp = { width, height, data };
  drawLine(stamp, text, { left: padding, top: padding, scale, weight: 1 });
  const sheet = sheetSize(style);
  return {
    ...stamp,
    left: sheet.width - width - 2 * style.marginPx,
    top: Math.trunc((sheet.height * STAMP_HEIGHT_PERCENT) / 100),
  };
};

const stampCovers = (stamp: Stamp | undefined, sheetX: number, sheetY: number): boolean => {
  if (stamp === undefined) return false;
  const [dx, dy] = [sheetX - stamp.left, sheetY - stamp.top];
  const x = dx + Math.trunc(dy / STAMP_SKEW);
  const y = dy - Math.trunc(dx / STAMP_SKEW);
  return (
    x >= 0 && x < stamp.width && y >= 0 && y < stamp.height && stamp.data[y * stamp.width + x] === 1
  );
};

const inkAround = ({ data: mask, width, height }: Mask, x: number, y: number) => {
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
  stampText?: string,
): GrayImage => {
  assertFits(lines, style);
  const sheet = sheetSize(style);
  const mask = inkMask(lines, style);
  const stamp = stampText === undefined ? undefined : stampOf(stampText, style);
  const width = sheet.width + 2 * style.deskPx;
  const height = sheet.height + 2 * style.deskPx;
  const random = createPrng(seed);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sheetX = x - style.deskPx + shift(y - (height >> 1), style.skew);
      const sheetY = y - style.deskPx - shift(x - (width >> 1), style.skew);
      const onSheet = sheetX >= 0 && sheetX < sheet.width && sheetY >= 0 && sheetY < sheet.height;
      const ink = onSheet ? Math.min(FULL_INK_NEIGHBOURS, inkAround(mask, sheetX, sheetY)) : 0;
      const printed = onSheet
        ? style.paper - Math.round(((style.paper - style.ink) * ink) / FULL_INK_NEIGHBOURS)
        : style.desk;
      const tone =
        onSheet && stampCovers(stamp, sheetX, sheetY) ? Math.min(printed, STAMP_TONE) : printed;
      const shade = Math.trunc((style.shade * (x + y)) / (width + height));
      const grain = Math.floor(random() * (2 * style.noise + 1)) - style.noise;
      data[y * width + x] = Math.max(0, Math.min(255, tone - shade + grain));
    }
  }
  return { width, height, data };
};
