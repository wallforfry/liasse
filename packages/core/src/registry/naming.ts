import { significantEntityTokens } from '../domain/entity-name.ts';
import type { SchemaLanguage } from '../domain/enums.ts';
import { MAX_FIELD_NAME_LENGTH, MAX_SLUG_LENGTH } from '../domain/limits.ts';
import { CORE_FIELD_NAMES } from './core-fields.ts';

export const NAMING_RULES = [
  'snake_case',
  'too_long',
  'reserved',
  'digit',
  'month',
  'entity',
] as const;
export type NamingRule = (typeof NAMING_RULES)[number];

export interface NamingViolation {
  readonly rule: NamingRule;
  readonly message: string;
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

// The date words a slug may not carry, per schema language: the twelve months and their
// usual short forms, in ASCII. English is always checked, whatever the configuration.
// `satisfies` makes a schema language without its row a compile error.
// prettier-ignore
export const MONTH_WORDS = {
  en: [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  ],
  fr: [
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
    'janv', 'fevr', 'avr', 'juil', 'sept', 'oct', 'nov', 'dec',
  ],
  de: [
    'januar', 'februar', 'marz', 'maerz', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'dezember',
    'jan', 'feb', 'mrz', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'okt', 'nov', 'dez',
  ],
  es: [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
    'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'sept', 'oct', 'nov', 'dic',
  ],
  it: [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
    'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic',
  ],
} as const satisfies Readonly<Record<SchemaLanguage, readonly string[]>>;

const ALWAYS_CHECKED: SchemaLanguage = 'en';

const monthWords = (language: SchemaLanguage): ReadonlySet<string> =>
  new Set<string>([...MONTH_WORDS[ALWAYS_CHECKED], ...MONTH_WORDS[language]]);

const violation = (rule: NamingRule, message: string): NamingViolation => ({ rule, message });

const shapeViolations = (
  kind: string,
  name: string,
  maxLength: number,
): readonly NamingViolation[] => [
  ...(SNAKE_CASE.test(name)
    ? []
    : [
        violation(
          'snake_case',
          `${kind} "${name}" must be snake_case: lowercase ASCII letters and digits, words joined by one underscore, starting with a letter.`,
        ),
      ]),
  ...(name.length <= maxLength
    ? []
    : [
        violation(
          'too_long',
          `${kind} "${name}" has ${String(name.length)} characters; the maximum is ${String(maxLength)}.`,
        ),
      ]),
];

export const fieldNameViolations = (name: string): readonly NamingViolation[] => [
  ...shapeViolations('Field name', name, MAX_FIELD_NAME_LENGTH),
  ...(CORE_FIELD_NAMES.includes(name)
    ? [
        violation(
          'reserved',
          `Field name "${name}" is reserved: it is a field of the common core, which every document already has.`,
        ),
      ]
    : []),
];

// An alias only has to look like a slug: the slug of a merged type becomes an alias as it
// is, whatever the denylist would say about it today.
export const aliasViolations = (alias: string): readonly NamingViolation[] =>
  shapeViolations('Alias', alias, MAX_SLUG_LENGTH);

export interface SlugContext {
  readonly schemaLanguage: SchemaLanguage;
  // Canonical names and aliases of the known entities, as stored.
  readonly entityNames: readonly string[];
  // Slugs of the types the registry already holds.
  readonly typeSlugs: readonly string[];
}

// A shorter entity word inside a longer word is too often a coincidence: an operator
// called Free must not hold back `freelance_contract`.
const MIN_LENGTH_MATCHED_INSIDE_A_WORD = 6;

// A slug may not carry a significant word of a known entity name. One exception keeps
// generic words usable: a word some type slug already uses belongs to the vocabulary of
// the registry, and an entity that happens to be called Contract or Energy does not take
// it back. Nothing else tells such a word from a name without a dictionary.
const entityViolations = (
  slug: string,
  { entityNames, typeSlugs }: SlugContext,
): readonly NamingViolation[] => {
  const words = slug.split('_');
  const vocabulary = new Set(typeSlugs.flatMap((typeSlug) => typeSlug.split('_')));
  const carries = (token: string): boolean =>
    words.some(
      (word) =>
        word === token ||
        (token.length >= MIN_LENGTH_MATCHED_INSIDE_A_WORD && word.includes(token)),
    );
  return [...new Set(entityNames.flatMap(significantEntityTokens))]
    .filter((token) => !vocabulary.has(token) && carries(token))
    .map((token) =>
      violation(
        'entity',
        `Slug "${slug}" contains "${token}", a word of a known entity name: a type is generic and never names an issuer or a recipient.`,
      ),
    );
};

export const slugViolations = (slug: string, context: SlugContext): readonly NamingViolation[] => {
  const shape = shapeViolations('Slug', slug, MAX_SLUG_LENGTH);
  if (shape.some(({ rule }) => rule === 'snake_case')) return shape;
  const forbidden = monthWords(context.schemaLanguage);
  const months = slug.split('_').filter((word) => forbidden.has(word));
  return [
    ...shape,
    ...(/\d/.test(slug)
      ? [
          violation(
            'digit',
            `Slug "${slug}" contains a digit: a type is generic and never carries a date, a year, an amount or a number.`,
          ),
        ]
      : []),
    ...months.map((month) =>
      violation(
        'month',
        `Slug "${slug}" contains the month "${month}": a type is generic and never carries a date.`,
      ),
    ),
    ...entityViolations(slug, context),
  ];
};
