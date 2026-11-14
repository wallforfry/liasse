import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fieldPaths } from './field-paths.ts';
import type { TypeFields } from './fields.ts';
import { validateDocumentFields } from './validate-document-fields.ts';
import {
  coreValueSchema,
  extraValueSchema,
  valueSchemaForFields,
  type ValueWrapper,
} from './values.ts';

const FIELDS: TypeFields = {
  energy: { type: 'enum', values: ['electricity', 'gas'] },
  meter_id: { type: 'identifier', format: 'PDL' },
  consumption_kwh: { type: 'number' },
  billing_period: { type: 'period' },
  readings: { type: 'list', items: { type: 'date' } },
};

const traced: ValueWrapper = (value) =>
  z.strictObject({ value, page: z.number().int().min(1), quote: z.string().min(1) });

describe('valueSchemaForFields', () => {
  const schema = valueSchemaForFields(FIELDS);

  it('accepts values that match their primitive', () => {
    const values = {
      energy: 'gas',
      meter_id: '00000000000000',
      consumption_kwh: 312,
      billing_period: { start: '2026-09-01', end: '2026-09-30' },
      readings: ['2026-09-01', '2026-09-30'],
    };
    expect(schema.parse(values)).toEqual(values);
  });

  it('leaves every field optional', () => {
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ consumption_kwh: 312 })).toEqual({ consumption_kwh: 312 });
  });

  it('rejects a field the type does not define', () => {
    expect(schema.safeParse({ supplier: 'Synthetic Energy' }).success).toBe(false);
  });

  it('rejects a value of another primitive', () => {
    expect(schema.safeParse({ consumption_kwh: '312' }).success).toBe(false);
    expect(schema.safeParse({ energy: 'water' }).success).toBe(false);
    expect(schema.safeParse({ consumption_kwh: null }).success).toBe(false);
  });

  it('wraps each value, and only the values, when given a wrapper', () => {
    const wrapped = valueSchemaForFields(FIELDS, traced);
    expect(
      wrapped.safeParse({
        consumption_kwh: { value: 312, page: 1, quote: '312 kWh' },
        readings: { value: ['2026-09-01'], page: 2, quote: 'Reading on 1 September' },
      }).success,
    ).toBe(true);
    expect(wrapped.safeParse({ consumption_kwh: 312 }).success).toBe(false);
    expect(
      wrapped.safeParse({ consumption_kwh: { value: '312', page: 1, quote: '312 kWh' } }).success,
    ).toBe(false);
    expect(wrapped.safeParse({}).success).toBe(true);
  });
});

describe('coreValueSchema', () => {
  const core = coreValueSchema();

  it('accepts the example of the specification', () => {
    const values = {
      document_date: '2026-10-03',
      issuer: 'Synthetic Energy',
      recipient: 'Jane Doe',
      amount: { value: 84.2, currency: 'EUR' },
      period: { start: '2026-09-01', end: '2026-09-30' },
      due_date: '2026-10-18',
      reference: 'INV-0001',
      language: 'fr',
      key_dates: [{ kind: 'due', date: '2026-10-18', label: 'Payment due' }],
    };
    expect(core.parse(values)).toEqual(values);
  });

  it('leaves every core field optional', () => {
    expect(core.parse({})).toEqual({});
  });

  it.each([
    ['document_date', '2026-02-30'],
    ['issuer', ''],
    ['recipient', 12],
    ['amount', { value: 84.2, currency: 'ZZZ' }],
    ['period', { start: '2026-09-30', end: '2026-09-01' }],
    ['due_date', '18/10/2026'],
    ['reference', 42],
    ['language', 'fra'],
    ['key_dates', [{ kind: 'birthday', date: '2026-10-18', label: 'x' }]],
    ['key_dates', { kind: 'due', date: '2026-10-18', label: 'x' }],
  ])('rejects an invalid %s', (field, value) => {
    expect(core.safeParse({ [field]: value }).success).toBe(false);
  });

  it('rejects a field that is not part of the core', () => {
    expect(core.safeParse({ meter_id: '00000000000000' }).success).toBe(false);
  });

  it('wraps each core value and each key date', () => {
    const wrapped = coreValueSchema(traced);
    expect(
      wrapped.safeParse({
        document_date: { value: '2026-10-03', page: 1, quote: '3 October 2026' },
        key_dates: [
          {
            value: { kind: 'due', date: '2026-10-18', label: 'Payment due' },
            page: 1,
            quote: 'Due on 18 October 2026',
          },
        ],
      }).success,
    ).toBe(true);
    expect(wrapped.safeParse({ document_date: '2026-10-03' }).success).toBe(false);
    expect(
      wrapped.safeParse({ key_dates: [{ kind: 'due', date: '2026-10-18', label: 'Payment due' }] })
        .success,
    ).toBe(false);
  });
});

describe('extraValueSchema', () => {
  const extra = extraValueSchema();

  it('accepts free keys whose values are primitives', () => {
    const values = {
      'Customer No.': 'C-0001',
      loyalty_points: 120,
      paperless: true,
      contract_period: { start: '2026-01-01', end: '2026-12-31' },
      deposit: { value: 50, currency: 'EUR' },
      options: ['green', 'fixed'],
    };
    expect(extra.parse(values)).toEqual(values);
  });

  it('rejects a free object, a null and an empty key', () => {
    expect(extra.safeParse({ address: { street: '12 synthetic road' } }).success).toBe(false);
    expect(extra.safeParse({ note: null }).success).toBe(false);
    expect(extra.safeParse({ '': 'value' }).success).toBe(false);
  });

  it('wraps each value when given a wrapper', () => {
    const wrapped = extraValueSchema(traced);
    expect(
      wrapped.safeParse({ loyalty_points: { value: 120, page: 1, quote: '120 points' } }).success,
    ).toBe(true);
    expect(wrapped.safeParse({ loyalty_points: 120 }).success).toBe(false);
  });
});

describe('validateDocumentFields', () => {
  const type = { fields: FIELDS };

  it('returns the validated fields', () => {
    expect(validateDocumentFields(type, { energy: 'gas', consumption_kwh: 312 })).toEqual({
      ok: true,
      value: { energy: 'gas', consumption_kwh: 312 },
    });
  });

  it('reports each unknown field and each invalid value with its path', () => {
    const result = validateDocumentFields(type, {
      supplier: 'Synthetic Energy',
      energy: 'water',
      billing_period: { start: '2026-09-30', end: '2026-09-01' },
      readings: ['2026-09-01', 'yesterday'],
    });
    expect(result.ok).toBe(false);
    expect(
      (result.ok ? [] : result.error).map(({ field, code, path }) => ({ field, code, path })),
    ).toEqual([
      { field: 'energy', code: 'invalid_value', path: 'energy' },
      { field: 'billing_period', code: 'invalid_value', path: 'billing_period.end' },
      { field: 'readings', code: 'invalid_value', path: 'readings.1' },
      { field: 'supplier', code: 'unknown_field', path: 'supplier' },
    ]);
  });

  it('names the fields of the type when one is unknown', () => {
    const result = validateDocumentFields(type, { supplier: 'Synthetic Energy' });
    expect(result.ok ? '' : result.error[0]?.message).toContain('energy, meter_id');
    const empty = validateDocumentFields({ fields: {} }, { supplier: 'Synthetic Energy' });
    expect(empty.ok ? '' : empty.error[0]?.message).toBe(
      'The type has no field "supplier". It defines no field.',
    );
  });

  it('rejects fields that are not an object', () => {
    const result = validateDocumentFields(type, 'gas');
    expect(result.ok ? [] : result.error).toMatchObject([{ code: 'invalid_value', path: '' }]);
    expect(result.ok ? {} : result.error[0]).not.toHaveProperty('field');
  });
});

describe('fieldPaths', () => {
  it('lists the core paths, then the paths of the type, with their primitive', () => {
    const paths = fieldPaths({
      fields: {
        meter_id: { type: 'identifier' },
        readings: { type: 'list', items: { type: 'date' } },
      },
    });
    expect(paths.map(({ path, primitive }) => [path, primitive])).toEqual([
      ['core.document_date', 'date'],
      ['core.issuer', 'entity'],
      ['core.recipient', 'entity'],
      ['core.amount', 'money'],
      ['core.period', 'period'],
      ['core.due_date', 'date'],
      ['core.reference', 'text'],
      ['core.language', 'enum'],
      ['core.key_dates', 'key_dates'],
      ['fields.meter_id', 'identifier'],
      ['fields.readings', 'list'],
    ]);
  });

  it('gives the definition behind each primitive path', () => {
    const paths = fieldPaths({ fields: { readings: { type: 'list', items: { type: 'date' } } } });
    expect(paths.at(-1)).toEqual({
      path: 'fields.readings',
      primitive: 'list',
      definition: { type: 'list', items: { type: 'date' } },
    });
  });
});
