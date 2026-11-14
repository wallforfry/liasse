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

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const MONTH_TOKENS: ReadonlySet<string> = new Set([
  ...MONTHS,
  ...MONTHS.map((month) => month.slice(0, 3)),
  'sept',
]);

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

const entityViolations = (
  slug: string,
  entityNames: readonly (readonly string[])[],
): readonly NamingViolation[] => {
  const delimited = `_${slug}_`;
  return entityNames
    .filter((tokens) => delimited.includes(`_${tokens.join('_')}_`))
    .map((tokens) =>
      violation(
        'entity',
        `Slug "${slug}" contains the entity name "${tokens.join('_')}": a type is generic and never names an issuer or a recipient.`,
      ),
    );
};

// `entityNames` holds the normalized tokens of every known entity name and alias.
export const slugViolations = (
  slug: string,
  entityNames: readonly (readonly string[])[],
): readonly NamingViolation[] => {
  const shape = shapeViolations('Slug', slug, MAX_SLUG_LENGTH);
  if (shape.some(({ rule }) => rule === 'snake_case')) return shape;
  const months = slug.split('_').filter((token) => MONTH_TOKENS.has(token));
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
    ...entityViolations(slug, entityNames),
  ];
};
