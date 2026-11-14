export const CHUNK_MAX_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 100;

// Liasse has no tokenizer: the tokenizer belongs to the embedding model, which is swappable.
// Four characters per token is the usual average of subword tokenizers on European languages.
// It underestimates dense text (digits, identifiers, CJK), where a chunk then holds more model
// tokens than its budget says.
const CHARS_PER_TOKEN = 4;

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export interface PageText {
  readonly page: number;
  readonly text: string;
}

export interface Chunk {
  readonly pageFrom: number;
  readonly pageTo: number;
  readonly text: string;
}

export interface ChunkingOptions {
  readonly maxTokens?: number;
  readonly overlapTokens?: number;
}

// From the coarsest boundary to the finest. Each separator stays at the end of the piece it
// closes, so joining the pieces gives the text back.
const SEPARATORS: readonly RegExp[] = [/\n[^\S\n]*\n\s*/gu, /[.!?…]+["'’»)\]]*\s+/gu, /\s+/gu];

const splitAfter = (text: string, separator: RegExp): readonly string[] => {
  const cuts = [
    0,
    ...Array.from(text.matchAll(separator), (match) => match.index + match[0].length).filter(
      (end) => end < text.length,
    ),
    text.length,
  ];
  return cuts.slice(1).map((end, index) => text.slice(cuts[index], end));
};

const isHighSurrogate = (codeUnit: number): boolean => codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff;

// Last resort for a run without any whitespace, such as an encoded blob.
const splitByLength = (text: string, maxChars: number): readonly string[] => {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    const cut = end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) ? end - 1 : end;
    parts.push(text.slice(start, cut));
    start = cut;
  }
  return parts;
};

// Cuts a text into pieces that each fit the budget, at the coarsest boundary that does.
const piecesWithin = (text: string, budget: number, level = 0): readonly string[] => {
  if (estimateTokens(text) <= budget) return [text];
  const separator = SEPARATORS[level];
  if (separator === undefined) return splitByLength(text, budget * CHARS_PER_TOKEN);
  return splitAfter(text, separator).flatMap((piece) => piecesWithin(piece, budget, level + 1));
};

interface PackBudgets {
  readonly first: number;
  readonly next: number;
}

// The first group has no overlap in front of it, so it may use the whole chunk budget.
const pack = (pieces: readonly string[], budgets: PackBudgets): readonly string[] =>
  pieces.reduce<readonly string[]>((groups, piece) => {
    const last = groups.at(-1);
    const budget = groups.length === 1 ? budgets.first : budgets.next;
    return last !== undefined && estimateTokens(last + piece) <= budget
      ? [...groups.slice(0, -1), last + piece]
      : [...groups, piece];
  }, []);

const tailWithin = (text: string, budget: number): string => {
  if (budget === 0) return '';
  const pieces = piecesWithin(text, budget);
  const firstKept = pieces.reduceRight(
    (kept, _, index) =>
      kept === index + 1 && estimateTokens(pieces.slice(index).join('')) <= budget ? index : kept,
    pieces.length,
  );
  return pieces.slice(firstKept).join('');
};

const splitPage = (text: string, maxTokens: number, overlapTokens: number): readonly string[] => {
  const fresh = maxTokens - overlapTokens;
  const groups = pack(piecesWithin(text, fresh), { first: maxTokens, next: fresh });
  return groups
    .map((group, index) => tailWithin(groups[index - 1] ?? '', overlapTokens) + group)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '');
};

// One page at a time: a chunk never spans two pages, so its page range is exact.
export const chunkPages = (
  pages: readonly PageText[],
  { maxTokens = CHUNK_MAX_TOKENS, overlapTokens = CHUNK_OVERLAP_TOKENS }: ChunkingOptions = {},
): readonly Chunk[] => {
  if (!Number.isInteger(overlapTokens) || overlapTokens < 0) {
    throw new RangeError('overlapTokens must be a non-negative integer');
  }
  if (!Number.isInteger(maxTokens) || maxTokens <= overlapTokens) {
    throw new RangeError('maxTokens must be an integer greater than overlapTokens');
  }
  return pages.flatMap(({ page, text }) =>
    splitPage(text, maxTokens, overlapTokens).map((chunk) => ({
      pageFrom: page,
      pageTo: page,
      text: chunk,
    })),
  );
};

export interface ChunkContext {
  readonly title: string | null;
  readonly typeSlug: string | null;
}

// What the embedder reads. The stored chunk text stays free of this header, so snippets and
// full text only ever show the document's own words.
export const embeddingInput = (text: string, { title, typeSlug }: ChunkContext): string => {
  const header = [
    ...(title === null || title.trim() === '' ? [] : [`Title: ${title.trim()}`]),
    ...(typeSlug === null ? [] : [`Type: ${typeSlug}`]),
  ];
  return header.length === 0 ? text : `${header.join('\n')}\n\n${text}`;
};
