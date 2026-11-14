import type { SearchResults } from '@liasse/core/api';
import { html } from 'hono/html';
import { documentPath, type Markup, UI_ROOT } from '../markup.ts';

export interface SearchView {
  readonly query: string;
  readonly includePrivate: boolean;
  /** Undefined until a query is given. */
  readonly results?: SearchResults | undefined;
}

type Snippet = SearchResults['results'][number]['snippets'][number];

// Each part of the snippet is escaped on its own; only the marks around the matches are
// markup. Ranges are read in order and clamped to the text.
const highlighted = ({ text, highlights }: Snippet): Markup => {
  const ranges = [...highlights].sort((left, right) => left.start - right.start);
  const { parts, cursor } = ranges.reduce<{ parts: Markup[]; cursor: number }>(
    (state, { start, end }) => {
      const from = Math.max(state.cursor, Math.min(start, text.length));
      const to = Math.max(from, Math.min(end, text.length));
      return {
        parts: [
          ...state.parts,
          html`${text.slice(state.cursor, from)}`,
          html`<mark>${text.slice(from, to)}</mark>`,
        ],
        cursor: to,
      };
    },
    { parts: [], cursor: 0 },
  );
  return html`${parts}${text.slice(cursor)}`;
};

const resultList = (results: SearchResults): Markup =>
  results.results.length === 0
    ? html`<p>No document matches.</p>`
    : html`<ol>
        ${results.results.map(
          (result) =>
            html`<li>
              <a href="${documentPath(result.id)}">${result.title ?? result.id}</a>
              <span class="muted">${result.type ?? 'untyped'}</span>
              ${result.snippets.map(
                (snippet) =>
                  html`<p>
                    ${highlighted(snippet)}
                    <span class="muted">(page ${snippet.page_from})</span>
                  </p>`,
              )}
            </li>`,
        )}
      </ol>`;

export const searchPage = ({ query, includePrivate, results }: SearchView): Markup =>
  html`<form method="get" action="${UI_ROOT}/search" class="filters">
      <label>Query <input name="q" value="${query}" required /></label>
      <label class="check"
        ><input
          type="checkbox"
          name="private"
          value="true"
          ${includePrivate ? html`checked` : ''}
        />
        Include private documents</label
      >
      <button type="submit">Search</button>
    </form>
    ${results === undefined ? '' : resultList(results)}`;
