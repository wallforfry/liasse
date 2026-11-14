// Liasse has no tokenizer for the text model, whichever provider runs it. Four characters
// per token is the usual figure for prose in Latin script; a text that costs more (digits,
// CJK) only makes a prompt somewhat longer than its nominal budget.
export const CHARS_PER_TOKEN = 4;

// Spec, Classification: the model receives the first 2,000 tokens of the document.
export const CLASSIFICATION_OPENING_TOKENS = 2000;

// What one extraction call carries of a document. Beyond it the document is cut and the
// cut is recorded: extraction in several calls is not implemented.
export const MAX_EXTRACTION_TOKENS = 60_000;

export interface PageText {
  readonly page: number;
  readonly text: string;
}

// Cutting by UTF-16 units can leave the first half of a surrogate pair behind.
const cut = (text: string, characters: number): string =>
  text.slice(0, characters).replace(/[\uD800-\uDBFF]$/u, '');

export const openingOf = (pages: readonly PageText[], tokens: number): string =>
  cut(pages.map(({ text }) => text).join('\n\n'), tokens * CHARS_PER_TOKEN);

export interface BudgetedPages {
  readonly pages: readonly PageText[];
  readonly truncated: boolean;
}

// Whole pages in order while they fit, then the beginning of the first that does not.
export const withinBudget = (pages: readonly PageText[], tokens: number): BudgetedPages => {
  const budget = tokens * CHARS_PER_TOKEN;
  const kept: PageText[] = [];
  let used = 0;
  for (const page of pages) {
    const room = budget - used;
    if (page.text.length > room) {
      const partial = cut(page.text, room);
      return {
        pages: partial === '' ? kept : [...kept, { page: page.page, text: partial }],
        truncated: true,
      };
    }
    kept.push(page);
    used += page.text.length;
  }
  return { pages: kept, truncated: false };
};
