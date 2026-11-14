import { estimateTokens } from './token-estimate.ts';

export const CHUNK_MAX_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 100;

// The overlap repeats text: beyond this share of a chunk it would crowd out new text.
const MAX_OVERLAP_SHARE = 0.25;
const MIN_CHUNK_TOKENS = 4;

// A tokenizer does not count a text as the sum of its parts. When a chunk built from counted
// pieces comes out over the budget, the page is cut again with a budget reduced by this much.
const BUDGET_SHRINK = 0.9;
const MAX_SHRINKS = 5;

const TITLE_MAX_LENGTH = 200;

export type CountTokens = (texts: readonly string[]) => Promise<readonly number[]>;

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
  // The tokenizer of the embedding model when it has one to offer; an estimate otherwise.
  readonly countTokens?: CountTokens;
}

export class ChunkBudgetError extends Error {
  override readonly name = 'ChunkBudgetError';
}

interface Piece {
  readonly text: string;
  readonly tokens: number;
}

const estimateAll: CountTokens = (texts) => Promise.resolve(texts.map(estimateTokens));

const measure = async (texts: readonly string[], count: CountTokens): Promise<readonly Piece[]> => {
  const tokens = await count(texts);
  if (tokens.length !== texts.length) {
    throw new ChunkBudgetError(
      `The token counter returned ${String(tokens.length)} counts for ${String(texts.length)} texts`,
    );
  }
  return texts.map((text, index) => ({ text, tokens: tokens[index] ?? 0 }));
};

// From the coarsest boundary to the finest: paragraph, line, sentence, word. Each separator stays at the end of the piece it
// closes, so joining the pieces gives the text back.
const SEPARATORS: readonly RegExp[] = [
  /\n[^\S\n]*\n\s*/gu,
  /\n\s*/gu,
  /[.!?…]+["'’»)\]]*\s+|[。！？]+\s*/gu,
  /\s+/gu,
];

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

// Last resort for a run without any boundary, such as an encoded blob or unpunctuated CJK
// text: cut in two, never inside a surrogate pair. A single character cannot be cut.
const halves = (text: string): readonly string[] | undefined => {
  const middle = Math.floor(text.length / 2);
  const cut = isHighSurrogate(text.charCodeAt(middle - 1)) ? middle + 1 : middle;
  return cut <= 0 || cut >= text.length ? undefined : [text.slice(0, cut), text.slice(cut)];
};

const cutAt = (text: string, level: number): readonly string[] | undefined => {
  const separator = SEPARATORS[level];
  return separator === undefined ? halves(text) : splitAfter(text, separator);
};

// Cuts each text into pieces that fit the budget, at the coarsest boundary that does. The texts
// of one level are counted in one call: the counter may be a process away.
const piecesWithin = async (
  texts: readonly string[],
  budget: number,
  count: CountTokens,
  level = 0,
): Promise<readonly (readonly Piece[])[]> => {
  const whole = await measure(texts, count);
  const parts = whole.map((piece) =>
    piece.tokens <= budget ? undefined : cutAt(piece.text, level),
  );
  const finer = parts.flatMap((cut) => cut ?? []);
  if (finer.length === 0) return whole.map((piece) => [piece]);
  const resolved = await piecesWithin(finer, budget, count, level + 1);
  let taken = 0;
  return whole.map((piece, index) => {
    const cut = parts[index];
    if (cut === undefined) return [piece];
    const own = resolved.slice(taken, taken + cut.length).flat();
    taken += cut.length;
    return own;
  });
};

interface PackBudgets {
  readonly first: number;
  readonly next: number;
}

// The first group has no overlap in front of it, so it may use the whole chunk budget.
const pack = (pieces: readonly Piece[], budgets: PackBudgets): readonly Piece[] =>
  pieces.reduce<readonly Piece[]>((groups, piece) => {
    const last = groups.at(-1);
    const budget = groups.length === 1 ? budgets.first : budgets.next;
    return last !== undefined && last.tokens + piece.tokens <= budget
      ? [
          ...groups.slice(0, -1),
          { text: last.text + piece.text, tokens: last.tokens + piece.tokens },
        ]
      : [...groups, piece];
  }, []);

// The longest run of whole pieces, taken from the end, that fits the budget.
const tailWithin = (pieces: readonly Piece[], budget: number): string => {
  const kept = pieces.reduceRight<{ readonly from: number; readonly tokens: number }>(
    (tail, piece, index) =>
      tail.from === index + 1 && tail.tokens + piece.tokens <= budget
        ? { from: index, tokens: tail.tokens + piece.tokens }
        : tail,
    { from: pieces.length, tokens: 0 },
  );
  return pieces
    .slice(kept.from)
    .map((piece) => piece.text)
    .join('');
};

interface Budgets {
  readonly maxTokens: number;
  readonly overlapTokens: number;
}

const assemble = async (
  text: string,
  { maxTokens, overlapTokens }: Budgets,
  count: CountTokens,
): Promise<readonly string[]> => {
  const fresh = maxTokens - overlapTokens;
  const [pieces = []] = await piecesWithin([text], fresh, count);
  const groups = pack(pieces, { first: maxTokens, next: fresh });
  const tails =
    overlapTokens === 0
      ? []
      : (
          await piecesWithin(
            groups.slice(0, -1).map((group) => group.text),
            overlapTokens,
            count,
          )
        ).map((tailPieces) => tailWithin(tailPieces, overlapTokens));
  return groups
    .map((group, index) => ((index === 0 ? undefined : tails[index - 1]) ?? '') + group.text)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '');
};

const splitPage = async (
  text: string,
  limit: number,
  budgets: Budgets,
  count: CountTokens,
  shrinks = 0,
): Promise<readonly string[]> => {
  const chunks = await assemble(text, budgets, count);
  const sizes = await measure(chunks, count);
  if (sizes.every((chunk) => chunk.tokens <= limit)) return chunks;
  if (shrinks === MAX_SHRINKS) {
    throw new ChunkBudgetError(`A page could not be cut into chunks of ${String(limit)} tokens`);
  }
  const shrunk = {
    maxTokens: Math.floor(budgets.maxTokens * BUDGET_SHRINK),
    overlapTokens: Math.floor(budgets.overlapTokens * BUDGET_SHRINK),
  };
  return splitPage(text, limit, shrunk, count, shrinks + 1);
};

// One page at a time: a chunk never spans two pages, so its page range is exact.
export const chunkPages = async (
  pages: readonly PageText[],
  {
    maxTokens = CHUNK_MAX_TOKENS,
    overlapTokens = CHUNK_OVERLAP_TOKENS,
    countTokens = estimateAll,
  }: ChunkingOptions = {},
): Promise<readonly Chunk[]> => {
  if (!Number.isInteger(overlapTokens) || overlapTokens < 0) {
    throw new RangeError('overlapTokens must be a non-negative integer');
  }
  if (!Number.isInteger(maxTokens) || maxTokens < MIN_CHUNK_TOKENS) {
    throw new RangeError(`maxTokens must be an integer of ${String(MIN_CHUNK_TOKENS)} or more`);
  }
  const budgets = {
    maxTokens,
    overlapTokens: Math.min(overlapTokens, Math.floor(maxTokens * MAX_OVERLAP_SHARE)),
  };
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    const texts = await splitPage(text, maxTokens, budgets, countTokens);
    chunks.push(...texts.map((chunk) => ({ pageFrom: page, pageTo: page, text: chunk })));
  }
  return chunks;
};

export interface ChunkContext {
  readonly title: string | null;
  readonly typeSlug: string | null;
}

// What the embedder reads. The stored chunk text stays free of this header, so snippets and
// full text only ever show the document's own words. The title is cut so that a long one
// cannot take the place of the text in the embedder's window.
export const embeddingInput = (text: string, { title, typeSlug }: ChunkContext): string => {
  const shownTitle = title?.trim().slice(0, TITLE_MAX_LENGTH) ?? '';
  const header = [
    ...(shownTitle === '' ? [] : [`Title: ${shownTitle}`]),
    ...(typeSlug === null ? [] : [`Type: ${typeSlug}`]),
  ];
  return header.length === 0 ? text : `${header.join('\n')}\n\n${text}`;
};
