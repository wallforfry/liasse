const isSpace = (char: string | undefined): boolean =>
  char === ' ' || char === '\n' || char === '\t' || char === '\r';

// The index of the `>` that closes a tag, looked for from `from`, or -1 when the tag never
// closes. A `>` inside a quoted attribute value does not close it, and a quote only opens
// a value right after `=`, so an apostrophe elsewhere in a tag is an ordinary character.
// One pass, no backtracking.
export const findTagEnd = (text: string, from: number): number => {
  let quote = '';
  let afterEquals = false;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === '>') {
      return index;
    } else {
      if (afterEquals && (char === '"' || char === "'")) quote = char;
      afterEquals = char === '=' || (afterEquals && isSpace(char));
    }
  }
  return -1;
};
