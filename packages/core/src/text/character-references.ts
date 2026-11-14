const fromCodePoint = (codePoint: number, fallback: string): string =>
  Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback;

// Decodes `&#233;`, `&#xE9;` and the names of `named`. A reference that is unknown or out
// of range is left as written: XML and HTML name different sets of entities.
export const decodeCharacterReferences = (
  text: string,
  named: ReadonlyMap<string, string>,
): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, reference: string) => {
    if (/^#x/i.test(reference))
      return fromCodePoint(Number.parseInt(reference.slice(2), 16), match);
    if (reference.startsWith('#')) {
      return fromCodePoint(Number.parseInt(reference.slice(1), 10), match);
    }
    return named.get(reference) ?? match;
  });
