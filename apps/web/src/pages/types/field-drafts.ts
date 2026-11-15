import {
  FIELD_PRIMITIVES,
  type FieldDefinition,
  type FieldPrimitive,
  type ScalarFieldDefinition,
} from '@liasse/contract/registry';

export type ScalarPrimitive = Exclude<FieldPrimitive, 'list'>;

export const SCALAR_PRIMITIVES: readonly ScalarPrimitive[] = FIELD_PRIMITIVES.filter(
  (primitive): primitive is ScalarPrimitive => primitive !== 'list',
);

export const isFieldPrimitive = (value: string): value is FieldPrimitive =>
  FIELD_PRIMITIVES.some((primitive) => primitive === value);

export const isScalarPrimitive = (value: string): value is ScalarPrimitive =>
  SCALAR_PRIMITIVES.some((primitive) => primitive === value);

/** A row of the creation form: every input it shows, whichever primitive is chosen. */
export interface FieldDraft {
  readonly key: number;
  readonly name: string;
  readonly primitive: FieldPrimitive;
  /** The primitive of the items, for a list. */
  readonly items: ScalarPrimitive;
  /** The values of an enum, separated by commas. */
  readonly values: string;
  /** The format of an identifier, optional. */
  readonly format: string;
}

export const emptyField = (key: number): FieldDraft => ({
  key,
  name: '',
  primitive: 'text',
  items: 'text',
  values: '',
  format: '',
});

const enumValues = (values: string): readonly string[] =>
  values
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');

const scalarDefinition = (
  type: ScalarPrimitive,
  { values, format }: Pick<FieldDraft, 'values' | 'format'>,
): ScalarFieldDefinition => {
  switch (type) {
    case 'enum':
      return { type, values: enumValues(values) };
    case 'identifier':
      return format.trim() === '' ? { type } : { type, format: format.trim() };
    default:
      return { type };
  }
};

/** The scalar primitive whose parameters the row asks for: the item type of a list. */
export const parameterOf = ({ primitive, items }: FieldDraft): ScalarPrimitive =>
  primitive === 'list' ? items : primitive;

export const fieldDefinition = (draft: FieldDraft): FieldDefinition =>
  draft.primitive === 'list'
    ? { type: 'list', items: scalarDefinition(draft.items, draft) }
    : scalarDefinition(draft.primitive, draft);

/** Names given to more than one row: an object keeps only one of them. */
export const repeatedNames = (drafts: readonly FieldDraft[]): readonly string[] => {
  const names = drafts.map(({ name }) => name.trim());
  return [...new Set(names.filter((name, index) => name !== '' && names.indexOf(name) !== index))];
};

/** Whether a row has no name yet: an object cannot carry it, so it is never sent. */
export const hasUnnamedRow = (drafts: readonly FieldDraft[]): boolean =>
  drafts.some(({ name }) => name.trim() === '');

/** The fields of the request, names trimmed; the registry judges the names. */
export const fieldsOf = (
  drafts: readonly FieldDraft[],
): Readonly<Record<string, FieldDefinition>> =>
  Object.fromEntries(drafts.map((draft) => [draft.name.trim(), fieldDefinition(draft)]));

/** The primitive as the registry writes it, `list<number>` for a list. */
export const primitiveLabel = (definition: FieldDefinition): string =>
  definition.type === 'list' ? `list<${definition.items.type}>` : definition.type;

/** The parameters of a definition: the values of an enum, the format of an identifier. */
export const parametersLabel = (definition: FieldDefinition): string => {
  const scalar = definition.type === 'list' ? definition.items : definition;
  if (scalar.type === 'enum') return scalar.values.join(', ');
  if (scalar.type === 'identifier') return scalar.format ?? '';
  return '';
};
