import { nameTokens } from '../domain/entity-name.ts';
import { MIN_ADDRESS_NUMBERS, MIN_ADDRESS_TOKENS } from '../domain/limits.ts';

// Ways of writing the same word of an address. Only forms that mean one thing are listed:
// "st" is a street and a saint, and is left as written.
// prettier-ignore
const WRITTEN_AS: ReadonlyMap<string, string> = new Map([
  ['av', 'avenue'], ['ave', 'avenue'],
  ['bd', 'boulevard'], ['blvd', 'boulevard'], ['boul', 'boulevard'],
  ['rte', 'route'], ['che', 'chemin'], ['imp', 'impasse'], ['sq', 'square'],
  ['rd', 'road'], ['ln', 'lane'],
  ['str', 'strasse'],
  ['apt', 'appartement'], ['appt', 'appartement'], ['apartment', 'appartement'],
  ['bat', 'batiment'],
]);

// Words that link the others and that a document may leave out.
// prettier-ignore
const LINKING_WORDS: ReadonlySet<string> = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'of', 'the', 'der', 'die', 'das', 'del', 'di',
]);

const STREET_SUFFIX = 'str';

// "Hauptstr." is "Hauptstrasse".
const expand = (token: string): string => {
  const written = WRITTEN_AS.get(token);
  if (written !== undefined) return written;
  return token.length > STREET_SUFFIX.length && token.endsWith(STREET_SUFFIX)
    ? `${token}asse`
    : token;
};

const tokensOf = (address: string): readonly string[] =>
  nameTokens(address.replaceAll('ß', 'ss'))
    .map(expand)
    .filter((token) => !LINKING_WORDS.has(token));

// What two addresses must share to be the same place: their words in the order written,
// lowercase, without accents, punctuation, linking words or the usual abbreviations. The
// order is kept: "3 rue du 12 Septembre" and "12 rue du 3 Septembre" are two places. Two
// spellings this does not bring together stay two addresses, and at worst two subjects.
export const addressKey = (address: string): string => tokensOf(address).join(' ');

const hasDigit = (token: string): boolean => /\p{Nd}/u.test(token);

// An address written in full: a number in the street and a postal code, and words with
// them. Only such an address says on its own which property a document is about. "Rue
// des Lilas, Lyon" is the street of many homes.
export const isCompleteAddress = (key: string): boolean => {
  const tokens = key.split(' ');
  return (
    tokens.length >= MIN_ADDRESS_TOKENS && tokens.filter(hasDigit).length >= MIN_ADDRESS_NUMBERS
  );
};
