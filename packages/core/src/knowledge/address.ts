import { nameTokens } from '../domain/entity-name.ts';

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

// The words that start the name of a street, after its number, in the schema languages.
// prettier-ignore
const STREET_TYPES: ReadonlySet<string> = new Set([
  'rue', 'avenue', 'boulevard', 'route', 'chemin', 'impasse', 'square', 'place', 'allee',
  'quai', 'cours', 'passage', 'voie', 'sentier', 'faubourg', 'rond', 'cite', 'promenade',
  'road', 'lane', 'street', 'way', 'drive', 'court', 'terrace', 'close', 'crescent',
  'via', 'viale', 'piazza', 'corso', 'vicolo', 'strada', 'largo',
  'calle', 'avenida', 'paseo', 'plaza', 'carrer', 'camino', 'ronda',
  'strasse',
]);

// Endings of a German street name, which its number follows: "Hauptstrasse 5".
const STREET_ENDINGS = ['strasse', 'weg', 'platz', 'allee', 'gasse', 'ring', 'damm', 'ufer'];

const HOUSE_NUMBER = /^\d{1,4}[a-z]?$/;
const POSTAL_CODE = /^\d{4,5}$/;

const isStreetEnding = (token: string): boolean =>
  STREET_ENDINGS.some((ending) => token.endsWith(ending));

// How far after its number the type of a street may come: past a repetition index ("12
// bis rue", "7 B rue") and the name of a street written first ("221 Baker Street").
const STREET_TYPE_REACH = 4;

// Where the street and its house number end, when the address starts with them: a number
// then a street ("12 bis rue des Lilas", "221 Baker Street"), or a German street then its
// number ("Hauptstrasse 5", "Berliner Strasse 5"). Undefined otherwise: a number inside
// the name of a street ("rue du 11 Novembre 1918"), a building, an apartment or a
// post-office box ("BP 123") is not the number of a house.
const endOfHouseNumber = (tokens: readonly string[]): number | undefined => {
  const [first = '', second = ''] = tokens;
  if (HOUSE_NUMBER.test(first)) {
    const type = tokens
      .slice(1, 1 + STREET_TYPE_REACH)
      .findIndex((token) => STREET_TYPES.has(token));
    return type === -1 ? undefined : 1 + type;
  }
  const street = [first, second].findIndex(isStreetEnding);
  return street !== -1 && HOUSE_NUMBER.test(tokens[street + 1] ?? '') ? street + 1 : undefined;
};

// An address written in full: a house number in its street, then a postal code. Only such
// an address says on its own which property a document is about. "Rue des Lilas, Lyon"
// is the street of many homes, and so is "Rue du 11 Novembre 1918, 69003 Lyon".
export const isCompleteAddress = (key: string): boolean => {
  const tokens = key.split(' ');
  const street = endOfHouseNumber(tokens);
  return street !== undefined && tokens.slice(street + 1).some((token) => POSTAL_CODE.test(token));
};
