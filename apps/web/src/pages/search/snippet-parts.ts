import type { SearchResults } from '@liasse/sdk';

export type Snippet = SearchResults['results'][number]['snippets'][number];

export interface SnippetPart {
  readonly text: string;
  readonly marked: boolean;
}

/** The text of a snippet cut at its highlights, read in order and clamped to the text. */
export const snippetParts = ({ text, highlights }: Snippet): readonly SnippetPart[] => {
  const ranges = highlights.toSorted((left, right) => left.start - right.start);
  const { parts, cursor } = ranges.reduce<{
    readonly parts: readonly SnippetPart[];
    readonly cursor: number;
  }>(
    (state, { start, end }) => {
      const from = Math.max(state.cursor, Math.min(start, text.length));
      const to = Math.max(from, Math.min(end, text.length));
      return {
        parts: [
          ...state.parts,
          { text: text.slice(state.cursor, from), marked: false },
          { text: text.slice(from, to), marked: true },
        ],
        cursor: to,
      };
    },
    { parts: [], cursor: 0 },
  );
  return [...parts, { text: text.slice(cursor), marked: false }].filter((part) => part.text !== '');
};
