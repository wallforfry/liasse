// Liasse has no tokenizer of its own: the tokenizer belongs to the embedding model. This
// estimate serves the embedders that cannot count, and is the only place that approximates.
//
// The rates are hundredths of a token per character (integers, so that sums are exact). They
// are set above what the multilingual SentencePiece tokenizer of the e5 family produces on
// prose, capitals, numbers, invoice lines and CJK text, so that the estimate errs on the side
// of smaller chunks. Whitespace costs nothing: it merges into the token of the word that
// follows. A random string, such as an encoded blob, can still cost more than its estimate.
const RATES: readonly (readonly [RegExp, number])[] = [
  [/\s/u, 0],
  [/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, 100],
  [/\p{Script=Hangul}/u, 75],
  [/(?=\p{Ll})\p{Script=Latin}|\p{M}/u, 30],
  [/\p{Script=Latin}/u, 55],
  [/\p{L}/u, 45],
];
// Numbers, punctuation and symbols.
const OTHER_RATE = 65;

const rateOf = (character: string): number =>
  RATES.find(([pattern]) => pattern.test(character))?.[1] ?? OTHER_RATE;

export const estimateTokens = (text: string): number =>
  Math.ceil(Array.from(text).reduce((tokens, character) => tokens + rateOf(character), 0) / 100);
