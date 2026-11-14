const isSpace = (char: string | undefined): boolean =>
  char === ' ' || char === '\n' || char === '\t' || char === '\r';

// Where the scan stands inside a tag: among names, right after the `=` of an attribute,
// inside an unquoted value, or inside a value quoted with `"` or `'`.
type TagState = 'names' | 'equals' | 'unquoted' | '"' | "'";

const nextState = (state: TagState, char: string | undefined): TagState => {
  switch (state) {
    case '"':
    case "'":
      return char === state ? 'names' : state;
    case 'unquoted':
      return isSpace(char) ? 'names' : 'unquoted';
    case 'equals':
      if (char === '"' || char === "'") return char;
      return isSpace(char) ? 'equals' : 'unquoted';
    case 'names':
      return char === '=' ? 'equals' : 'names';
  }
};

// The index of the `>` that closes a tag, looked for from `from`, or -1 when the tag never
// closes. A `>` inside a quoted attribute value does not close it. A quote only opens a
// value where the value starts, right after `=` and optional spaces: elsewhere, in a name
// or inside an unquoted value, it is an ordinary character, as it is for a browser.
// One pass, no backtracking.
export const findTagEnd = (text: string, from: number): number => {
  let state: TagState = 'names';
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '>' && state !== '"' && state !== "'") return index;
    state = nextState(state, char);
  }
  return -1;
};
