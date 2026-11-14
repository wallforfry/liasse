import { decodeCharacterReferences } from '../character-references.ts';

// The named entities of ISO 8859-1 in code point order, from U+00A0 to U+00FF: together
// with the few below they cover what mail clients write. An unknown name is left as it is.
const LATIN1_FIRST_CODE_POINT = 0xa0;
const LATIN1_NAMES = [
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr',
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest',
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml',
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig',
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml',
  'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml',
]
  .join(' ')
  .split(' ');

const HTML_ENTITIES: ReadonlyMap<string, string> = new Map([
  ...LATIN1_NAMES.map(
    (name, index) => [name, String.fromCodePoint(LATIN1_FIRST_CODE_POINT + index)] as const,
  ),
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['euro', '€'],
  ['hellip', '…'],
  ['ndash', '–'],
  ['mdash', '—'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['bull', '•'],
  ['trade', '™'],
  ['oelig', 'œ'],
  ['OElig', 'Œ'],
]);

export const decodeHtmlEntities = (text: string): string =>
  decodeCharacterReferences(text, HTML_ENTITIES);
