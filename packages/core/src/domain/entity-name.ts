// prettier-ignore
const LEGAL_FORMS: ReadonlySet<string> = new Set([
  'sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'snc', 'scop',
  'ltd', 'limited', 'llc', 'llp', 'plc', 'inc', 'corp', 'corporation',
  'gmbh', 'ag', 'kg', 'ug', 'bv', 'nv', 'spa', 'srl', 'sl', 'ab', 'as', 'oy',
]);

// "No accents" is a rule about Latin letters, where a diacritic is a variant of spelling.
// In other scripts a mark makes another word: a voiced kana, a Devanagari or Thai vowel
// sign, the breve of a Cyrillic letter, a Greek tonos. So a Latin letter loses its
// combining marks, and nothing else does.
const withoutLatinDiacritics = (text: string): string =>
  text.replace(/\p{Script=Latin}\p{M}*/gu, (letter) =>
    letter.normalize('NFD').replace(/\p{M}/gu, ''),
  );

// Compatibility forms are folded first, by NFKC: full-width and half-width characters,
// ligatures and the like become the plain ones, and every letter comes out composed with
// its marks. Dotted abbreviations such as "S.A." or "Inc." must end up as one token.
// Letters, marks and digits of every script make the words: a name must not lose what
// tells it apart because it is not written in Latin letters.
const tokenize = (name: string): readonly string[] =>
  withoutLatinDiacritics(name.normalize('NFKC'))
    .replace(/\./g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
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

// Lowercase tokens of an entity name, without accents and without the legal form around
// it. A name made only of legal-form words keeps them, so it never becomes empty.
export const normalizeEntityName = (name: string): readonly string[] =>
  withoutLegalForm(tokenize(name));

// What two names must share to name the same entity. A name written without any letter
// or digit has no token: it is compared as written, so that two such names are not equal
// to each other for having nothing left.
export const entityNameKey = (name: string): string => {
  const tokens = normalizeEntityName(name);
  return tokens.length > 0 ? tokens.join(' ') : name.normalize('NFKC').trim().toLowerCase();
};

// The words that say something: no function word, nothing under three characters.
export const significantWords = (words: readonly string[]): readonly string[] =>
  words.filter((word) => word.length >= MIN_SIGNIFICANT_LENGTH && !FUNCTION_WORDS.has(word));

// The significant words of an entity name, without its legal form.
export const significantEntityTokens = (name: string): readonly string[] =>
  significantWords(normalizeEntityName(name));
