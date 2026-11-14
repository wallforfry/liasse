// prettier-ignore
const LEGAL_FORMS: ReadonlySet<string> = new Set([
  'sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'snc', 'scop',
  'ltd', 'limited', 'llc', 'llp', 'plc', 'inc', 'corp', 'corporation',
  'gmbh', 'ag', 'kg', 'ug', 'bv', 'nv', 'spa', 'srl', 'sl', 'ab', 'as', 'oy',
]);

// Dotted abbreviations such as "S.A." or "Inc." must end up as one token.
const tokenize = (name: string): readonly string[] =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\./g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');

const withoutLegalForm = (tokens: readonly string[]): readonly string[] => {
  const first = tokens.findIndex((token) => !LEGAL_FORMS.has(token));
  const last = tokens.findLastIndex((token) => !LEGAL_FORMS.has(token));
  return first === -1 ? tokens : tokens.slice(first, last + 1);
};

// Function words of the schema languages, three characters or more: shorter ones never
// count as significant anyway.
// prettier-ignore
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for',
  'les', 'des', 'une', 'aux', 'sur', 'pour', 'par',
  'der', 'die', 'das', 'und', 'von', 'fur',
  'del', 'los', 'las', 'con', 'por', 'para',
  'dei', 'degli', 'della', 'delle', 'per',
]);

const MIN_SIGNIFICANT_LENGTH = 3;

// Lowercase ASCII tokens of an entity name, without accents and without the legal form
// around it. A name made only of legal-form words keeps them, so it never becomes empty.
export const normalizeEntityName = (name: string): readonly string[] =>
  withoutLegalForm(tokenize(name));

// The words that say something: no function word, nothing under three characters.
export const significantWords = (words: readonly string[]): readonly string[] =>
  words.filter((word) => word.length >= MIN_SIGNIFICANT_LENGTH && !FUNCTION_WORDS.has(word));

// The significant words of an entity name, without its legal form.
export const significantEntityTokens = (name: string): readonly string[] =>
  significantWords(normalizeEntityName(name));
