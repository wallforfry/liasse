import { MAX_FIELDS_PER_TYPE } from '@liasse/contract/domain';
import { describe, expect, it } from 'vitest';
import {
  FIELD_ANNOTATION,
  InvalidTypeSchemaError,
  parseTypeSchema,
  renderTypeSchema,
} from './stored-schema.ts';

const FIELDS = {
  energy: { type: 'enum', values: ['electricity', 'gas'] },
  meter_id: { type: 'identifier', format: 'PDL' },
  consumption_kwh: { type: 'number' },
  billed: { type: 'money' },
  readings: { type: 'list', items: { type: 'date' } },
};

describe('renderTypeSchema', () => {
  it('renders a closed JSON Schema object whose properties carry their definition', () => {
    expect(renderTypeSchema(FIELDS)).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        energy: {
          type: 'string',
          enum: ['electricity', 'gas'],
          [FIELD_ANNOTATION]: { type: 'enum', values: ['electricity', 'gas'] },
        },
        meter_id: {
          type: 'string',
          [FIELD_ANNOTATION]: { type: 'identifier', format: 'PDL' },
        },
        consumption_kwh: { type: 'number', [FIELD_ANNOTATION]: { type: 'number' } },
        billed: {
          type: 'object',
          required: ['value', 'currency'],
          additionalProperties: false,
          [FIELD_ANNOTATION]: { type: 'money' },
        },
        readings: {
          type: 'array',
          items: { type: 'string', format: 'date' },
          [FIELD_ANNOTATION]: { type: 'list', items: { type: 'date' } },
        },
      },
    });
  });

  it('requires no field: a document only carries what was found', () => {
    expect(renderTypeSchema(FIELDS)).not.toHaveProperty('required');
  });

  it('renders a type without fields', () => {
    expect(renderTypeSchema({})).toMatchObject({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it.each([
    ['an unknown primitive', { notes: { type: 'object' } }],
    [
      'a list of lists',
      { tags: { type: 'list', items: { type: 'list', items: { type: 'text' } } } },
    ],
    ['a reserved name', { issuer: { type: 'entity' } }],
    ['a name that is not snake_case', { MeterId: { type: 'identifier' } }],
    [
      'too many fields',
      Object.fromEntries(
        Array.from({ length: MAX_FIELDS_PER_TYPE + 1 }, (_, index) => [
          `field_${String(index)}`,
          { type: 'text' },
        ]),
      ),
    ],
    ['something that is not an object', 'fields'],
  ])('refuses to render %s', (_, fields) => {
    expect(() => renderTypeSchema(fields)).toThrow(InvalidTypeSchemaError);
  });
});

describe('parseTypeSchema', () => {
  it('reads back the fields a schema was rendered from', () => {
    expect(parseTypeSchema(renderTypeSchema(FIELDS))).toEqual(FIELDS);
    expect(parseTypeSchema(renderTypeSchema({}))).toEqual({});
  });

  it('survives the round trip through JSON', () => {
    const stored: unknown = JSON.parse(JSON.stringify(renderTypeSchema(FIELDS)));
    expect(parseTypeSchema(stored)).toEqual(FIELDS);
  });

  it('reads back a field named constructor', () => {
    const fields = { constructor: { type: 'text' } };
    expect(Object.entries(parseTypeSchema(renderTypeSchema(fields)))).toEqual([
      ['constructor', { type: 'text' }],
    ]);
    expect(renderTypeSchema(fields)).toMatchObject({
      properties: { constructor: { type: 'string', minLength: 1 } },
    });
  });

  it('sees a stored property named __proto__ and refuses it', () => {
    const stored: unknown = JSON.parse(
      '{"type":"object","additionalProperties":false,"properties":{"__proto__":{"x-liasse-field":{"type":"text"}}}}',
    );
    expect(() => parseTypeSchema(stored)).toThrow(InvalidTypeSchemaError);
  });

  it.each([
    ['an empty object', {}],
    ['the registry format instead of a JSON Schema', { fields: FIELDS }],
    ['an open object', { type: 'object', properties: {}, additionalProperties: true }],
    ['a schema that is not an object', { type: 'string' }],
    ['a null', null],
    [
      'a property without its definition',
      { type: 'object', additionalProperties: false, properties: { notes: { type: 'string' } } },
    ],
    [
      'a property with an invalid definition',
      {
        type: 'object',
        additionalProperties: false,
        properties: { notes: { type: 'string', [FIELD_ANNOTATION]: { type: 'object' } } },
      },
    ],
    [
      'a property with a reserved name',
      {
        type: 'object',
        additionalProperties: false,
        properties: { amount: { [FIELD_ANNOTATION]: { type: 'money' } } },
      },
    ],
  ])('rejects %s', (_, stored) => {
    expect(() => parseTypeSchema(stored)).toThrow(InvalidTypeSchemaError);
  });
});
