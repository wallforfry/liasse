import { describe, expect, it } from 'vitest';
import { MAX_ENUM_VALUES, MAX_IDENTIFIER_FORMAT_LENGTH } from '../domain/limits.ts';
import {
  FIELD_PRIMITIVES,
  type FieldDefinition,
  fieldDefinitionSchema,
  fieldValueSchema,
  untypedValueSchema,
} from './primitives.ts';

const defines = (definition: unknown): boolean =>
  fieldDefinitionSchema.safeParse(definition).success;

const accepts = (definition: FieldDefinition, value: unknown): boolean =>
  fieldValueSchema(definition).safeParse(value).success;

describe('field definitions', () => {
  it('lists the primitives of the specification', () => {
    expect(FIELD_PRIMITIVES).toEqual([
      'text',
      'number',
      'boolean',
      'date',
      'period',
      'money',
      'entity',
      'enum',
      'identifier',
      'list',
    ]);
  });

  it.each(['text', 'number', 'boolean', 'date', 'period', 'money', 'entity', 'identifier'])(
    'accepts %s without any parameter',
    (type) => {
      expect(defines({ type })).toBe(true);
    },
  );

  it('accepts the definitions of the specification example', () => {
    expect(defines({ type: 'enum', values: ['electricity', 'gas', 'dual'] })).toBe(true);
    expect(defines({ type: 'identifier', format: 'PDL' })).toBe(true);
    expect(defines({ type: 'list', items: { type: 'text' } })).toBe(true);
    expect(defines({ type: 'list', items: { type: 'enum', values: ['a', 'b'] } })).toBe(true);
  });

  it('rejects an unknown primitive and a free nested object', () => {
    expect(defines({ type: 'object' })).toBe(false);
    expect(defines({ type: 'object', properties: { a: { type: 'text' } } })).toBe(false);
    expect(defines({ type: 'string' })).toBe(false);
    expect(defines('text')).toBe(false);
    expect(defines({})).toBe(false);
  });

  it('rejects a parameter the primitive does not have', () => {
    expect(defines({ type: 'text', format: 'PDL' })).toBe(false);
    expect(defines({ type: 'number', values: ['a'] })).toBe(false);
    expect(defines({ type: 'identifier', format: 'PDL', values: ['a'] })).toBe(false);
  });

  it('rejects a list of lists and a list without items', () => {
    expect(defines({ type: 'list', items: { type: 'list', items: { type: 'text' } } })).toBe(false);
    expect(defines({ type: 'list' })).toBe(false);
  });

  it('rejects an enum without values, with an empty value or with a duplicate', () => {
    expect(defines({ type: 'enum' })).toBe(false);
    expect(defines({ type: 'enum', values: [] })).toBe(false);
    expect(defines({ type: 'enum', values: ['a', ''] })).toBe(false);
    expect(defines({ type: 'enum', values: ['a', 'a'] })).toBe(false);
    expect(defines({ type: 'enum', values: [1, 2] })).toBe(false);
  });

  it(`caps an enum at ${String(MAX_ENUM_VALUES)} values`, () => {
    const values = (count: number) =>
      Array.from({ length: count }, (_, index) => `v${String(index)}`);
    expect(defines({ type: 'enum', values: values(MAX_ENUM_VALUES) })).toBe(true);
    expect(defines({ type: 'enum', values: values(MAX_ENUM_VALUES + 1) })).toBe(false);
  });

  it(`caps an identifier format at ${String(MAX_IDENTIFIER_FORMAT_LENGTH)} characters`, () => {
    expect(defines({ type: 'identifier', format: 'x'.repeat(MAX_IDENTIFIER_FORMAT_LENGTH) })).toBe(
      true,
    );
    expect(
      defines({ type: 'identifier', format: 'x'.repeat(MAX_IDENTIFIER_FORMAT_LENGTH + 1) }),
    ).toBe(false);
    expect(defines({ type: 'identifier', format: '' })).toBe(false);
  });
});

describe('field values', () => {
  it('validates text, entity and identifier as non-empty strings', () => {
    const definitions: readonly FieldDefinition[] = [
      { type: 'text' },
      { type: 'entity' },
      { type: 'identifier', format: 'PDL' },
    ];
    definitions.forEach((definition) => {
      expect(accepts(definition, 'value')).toBe(true);
      expect(accepts(definition, '')).toBe(false);
      expect(accepts(definition, 12)).toBe(false);
    });
  });

  it('validates number and boolean without coercion', () => {
    expect(accepts({ type: 'number' }, 312.5)).toBe(true);
    expect(accepts({ type: 'number' }, '312.5')).toBe(false);
    expect(accepts({ type: 'number' }, Number.NaN)).toBe(false);
    expect(accepts({ type: 'boolean' }, false)).toBe(true);
    expect(accepts({ type: 'boolean' }, 'false')).toBe(false);
  });

  it('validates date, period and money with the shared value schemas', () => {
    expect(accepts({ type: 'date' }, '2026-10-03')).toBe(true);
    expect(accepts({ type: 'date' }, '2026-02-30')).toBe(false);
    expect(accepts({ type: 'period' }, { start: '2026-09-01', end: '2026-09-30' })).toBe(true);
    expect(accepts({ type: 'period' }, { start: '2026-09-30', end: '2026-09-01' })).toBe(false);
    expect(accepts({ type: 'money' }, { value: 84.2, currency: 'EUR' })).toBe(true);
    expect(accepts({ type: 'money' }, { value: 84.2, currency: 'ZZZ' })).toBe(false);
    expect(accepts({ type: 'money' }, 84.2)).toBe(false);
  });

  it('validates an enum against its listed values', () => {
    const energy: FieldDefinition = { type: 'enum', values: ['electricity', 'gas'] };
    expect(accepts(energy, 'gas')).toBe(true);
    expect(accepts(energy, 'water')).toBe(false);
  });

  it('validates every item of a list with the primitive of the list', () => {
    const dates: FieldDefinition = { type: 'list', items: { type: 'date' } };
    expect(accepts(dates, ['2026-10-03', '2026-10-18'])).toBe(true);
    expect(accepts(dates, [])).toBe(true);
    expect(accepts(dates, ['2026-10-03', '2026-02-30'])).toBe(false);
    expect(accepts(dates, '2026-10-03')).toBe(false);
  });
});

describe('untyped values', () => {
  const untyped = (value: unknown): boolean => untypedValueSchema.safeParse(value).success;

  it('accepts any value a parameterless primitive describes, and lists of them', () => {
    expect(untyped('free text')).toBe(true);
    expect(untyped(42)).toBe(true);
    expect(untyped(true)).toBe(true);
    expect(untyped({ start: '2026-09-01', end: '2026-09-30' })).toBe(true);
    expect(untyped({ value: 84.2, currency: 'EUR' })).toBe(true);
    expect(untyped(['a', 2, false])).toBe(true);
  });

  it('rejects a free object, a null, an empty string and a list of lists', () => {
    expect(untyped({ street: '12 synthetic road' })).toBe(false);
    expect(untyped({ value: 84.2, currency: 'ZZZ' })).toBe(false);
    expect(untyped(null)).toBe(false);
    expect(untyped('')).toBe(false);
    expect(untyped([['a']])).toBe(false);
    expect(untyped([{ nested: true }])).toBe(false);
  });
});
