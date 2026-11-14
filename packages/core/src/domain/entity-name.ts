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

// Lowercase ASCII tokens of an entity name, without accents and without the legal form
// around it. A name made only of legal-form words keeps them, so it never becomes empty.
export const normalizeEntityName = (name: string): readonly string[] =>
  withoutLegalForm(tokenize(name));
