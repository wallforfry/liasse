import { CEDILLA, CEDILLA_ROWS, GLYPHS, MARKS_ABOVE } from './glyphs.ts';

export const GLYPH_COLUMNS = 5;
// Two rows for the accent of a capital, seven for the letter, two below the baseline.
export const GLYPH_ROWS = 11;

const EMPTY_ROW = '.'.repeat(GLYPH_COLUMNS);
const BODY_AND_DESCENDER_ROWS = 9;
const DOTLESS_I = 'ı';

export class MissingGlyphError extends Error {
  override readonly name = 'MissingGlyphError';
}

const baseRows = (character: string): readonly string[] => {
  const rows = GLYPHS[character]?.split(' ');
  if (rows === undefined) {
    throw new MissingGlyphError(
      `The corpus face has no glyph for ${JSON.stringify(character)}: add it to glyphs.ts or reword the line`,
    );
  }
  return [...rows, EMPTY_ROW, EMPTY_ROW].slice(0, BODY_AND_DESCENDER_ROWS);
};

const withCedilla = (rows: readonly string[]): readonly string[] => [
  ...rows.slice(0, BODY_AND_DESCENDER_ROWS - CEDILLA_ROWS.length),
  ...CEDILLA_ROWS,
];

// The eleven rows of a character. A letter and its mark are separated by Unicode
// decomposition, so no accented letter needs a drawing of its own: the mark sits in the
// two free rows of a small letter, and above a capital or a letter with an ascender.
export const glyphRows = (character: string): readonly string[] => {
  const [base = ' ', ...marks] = Array.from(character.normalize('NFD'));
  const above = marks.map((mark) => MARKS_ABOVE[mark]).find((mark) => mark !== undefined);
  const unknown = marks.find((mark) => mark !== CEDILLA && MARKS_ABOVE[mark] === undefined);
  if (unknown !== undefined) {
    throw new MissingGlyphError(
      `The corpus face has no mark for ${JSON.stringify(character)}: add it to glyphs.ts or reword the line`,
    );
  }
  const letter = baseRows(above !== undefined && base === 'i' ? DOTLESS_I : base);
  const body = marks.includes(CEDILLA) ? withCedilla(letter) : letter;
  if (above === undefined) return [EMPTY_ROW, EMPTY_ROW, ...body];
  const isSmall = body[0] === EMPTY_ROW && body[1] === EMPTY_ROW;
  return isSmall ? [EMPTY_ROW, EMPTY_ROW, ...above, ...body.slice(2)] : [...above, ...body];
};
