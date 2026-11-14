// WinAnsiEncoding is Latin-1 except between 0x80 and 0x9F, where Latin-1 has control codes
// and WinAnsi has the euro sign, the typographic quotes, the dashes and a few letters.
// prettier-ignore
const WIN_ANSI_SPECIALS: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const LATIN_1_MAX = 0xff;

export class WinAnsiError extends Error {
  override readonly name = 'WinAnsiError';
}

// The bytes of a text set in a font that uses WinAnsiEncoding. A character the encoding
// does not have is refused: written as another one, it would be read back as that one.
export const encodeWinAnsi = (text: string): Uint8Array =>
  Uint8Array.from(Array.from(text), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const byte = WIN_ANSI_SPECIALS.get(codePoint) ?? codePoint;
    if (byte > LATIN_1_MAX) {
      throw new WinAnsiError(
        `WinAnsiEncoding has no character U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
      );
    }
    return byte;
  });
