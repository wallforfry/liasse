import { describe, expect, it } from 'vitest';
import { MANUAL_PROVENANCE } from '../domain/provenance.ts';
import { type DocumentValues, type Rehoming, rehomeValues } from './rehome-values.ts';

const rehomed = (document: DocumentValues, rehoming: Rehoming) => {
  const result = rehomeValues(document, rehoming);
  if (!result.ok) throw new Error(`Manual collision on ${result.error.manual.join(', ')}`);
  return result.value;
};

const EXTRACTED = { model: 'm', schema_version: 1, confidence: 0.9, page: 1, quote: 'q' };

describe('rehomeValues', () => {
  it('makes a renamed value the field it fits, with its provenance and manual mark', () => {
    const moved = rehomed(
      {
        fields: { meter: 'PDL-1' },
        extra: { customer_no: 'C-42', usage: 350 },
        provenance: { meter: EXTRACTED, customer_no: MANUAL_PROVENANCE, usage: EXTRACTED },
        manualFields: ['customer_no'],
      },
      {
        fields: { meter: { type: 'identifier' }, customer_number: { type: 'text' } },
        renames: new Map([['customer_no', 'customer_number']]),
      },
    );
    expect(moved).toEqual({
      fields: { meter: 'PDL-1', customer_number: 'C-42' },
      extra: { usage: 350 },
      provenance: { meter: EXTRACTED, customer_number: MANUAL_PROVENANCE, usage: EXTRACTED },
      manualFields: ['customer_number'],
    });
  });

  it('keeps in extra, under its own name, a value the schema has no field for', () => {
    const moved = rehomed(
      {
        fields: { meter: 'PDL-1', rate: 'blue' },
        extra: {},
        provenance: { meter: MANUAL_PROVENANCE, rate: EXTRACTED },
        manualFields: ['meter'],
      },
      { fields: { rate: { type: 'enum', values: ['blue', 'red'] } }, renames: new Map() },
    );
    expect(moved).toEqual({
      fields: { rate: 'blue' },
      extra: { meter: 'PDL-1' },
      provenance: { meter: MANUAL_PROVENANCE, rate: EXTRACTED },
      manualFields: ['meter'],
    });
  });

  it('keeps in extra a value that does not fit the definition of its field', () => {
    const moved = rehomed(
      { fields: {}, extra: { amount_due: 'twelve' }, provenance: {}, manualFields: [] },
      { fields: { amount: { type: 'number' } }, renames: new Map([['amount_due', 'amount']]) },
    );
    expect(moved).toMatchObject({ fields: {}, extra: { amount_due: 'twelve' } });
  });

  it('gives a field one value: a field wins over a variant of extra', () => {
    const moved = rehomed(
      {
        fields: { customer_number: 'C-1' },
        extra: { customer_no: 'C-2' },
        provenance: { customer_number: EXTRACTED, customer_no: EXTRACTED },
        manualFields: [],
      },
      {
        fields: { customer_number: { type: 'text' } },
        renames: new Map([['customer_no', 'customer_number']]),
      },
    );
    expect(moved).toMatchObject({
      fields: { customer_number: 'C-1' },
      extra: { customer_no: 'C-2' },
    });
  });

  const QUOTE_A = { ...EXTRACTED, quote: 'quote of a' };
  const QUOTE_B = { ...EXTRACTED, quote: 'quote of b' };
  const TEXT = { type: 'text' } as const;

  it('follows a chain of renames with each provenance and mark under its own value', () => {
    const moved = rehomed(
      {
        fields: { a: 'one', b: 'two' },
        extra: {},
        provenance: { a: QUOTE_A, b: MANUAL_PROVENANCE },
        manualFields: ['b'],
      },
      {
        fields: { b: TEXT, c: TEXT },
        renames: new Map([
          ['a', 'b'],
          ['b', 'c'],
        ]),
      },
    );
    expect(moved).toEqual({
      fields: { b: 'one', c: 'two' },
      extra: {},
      provenance: { b: QUOTE_A, c: MANUAL_PROVENANCE },
      manualFields: ['c'],
    });
  });

  it('swaps two values with their provenance', () => {
    const moved = rehomed(
      {
        fields: { a: 'one', b: 'two' },
        extra: {},
        provenance: { a: QUOTE_A, b: QUOTE_B },
        manualFields: ['a'],
      },
      {
        fields: { a: TEXT, b: TEXT },
        renames: new Map([
          ['a', 'b'],
          ['b', 'a'],
        ]),
      },
    );
    expect(moved).toEqual({
      fields: { b: 'one', a: 'two' },
      extra: {},
      provenance: { b: QUOTE_A, a: QUOTE_B },
      manualFields: ['b'],
    });
  });

  it('never lands a renamed value on the name of a manual value kept in extra', () => {
    const moved = rehomed(
      {
        fields: { a: 'extracted' },
        extra: { b: 42 },
        provenance: { a: QUOTE_A, b: MANUAL_PROVENANCE },
        manualFields: ['b'],
      },
      { fields: { b: TEXT }, renames: new Map([['a', 'b']]) },
    );
    expect(moved).toEqual({
      fields: {},
      extra: { a: 'extracted', b: 42 },
      provenance: { a: QUOTE_A, b: MANUAL_PROVENANCE },
      manualFields: ['b'],
    });
  });

  it('gives the field to a manual variant over an extracted value', () => {
    const moved = rehomed(
      {
        fields: {},
        extra: { customer_number: 'C-1', customer_no: 'C-MANUAL' },
        provenance: { customer_number: QUOTE_A, customer_no: MANUAL_PROVENANCE },
        manualFields: ['customer_no'],
      },
      { fields: { customer_number: TEXT }, renames: new Map([['customer_no', 'customer_number']]) },
    );
    expect(moved).toEqual({
      fields: { customer_number: 'C-MANUAL' },
      extra: {},
      provenance: { customer_number: MANUAL_PROVENANCE },
      manualFields: ['customer_number'],
    });
  });

  it('keeps the name of a field a person cleared free of any renamed value', () => {
    const moved = rehomed(
      { fields: { a: 'one' }, extra: {}, provenance: { a: QUOTE_A }, manualFields: ['b'] },
      { fields: { b: TEXT }, renames: new Map([['a', 'b']]) },
    );
    expect(moved).toEqual({
      fields: {},
      extra: { a: 'one' },
      provenance: { a: QUOTE_A },
      manualFields: ['b'],
    });
  });

  it('never drops a value a person corrected: two that compete for one field collide', () => {
    expect(
      rehomeValues(
        {
          fields: { a: 'manual a', x: 'manual x' },
          extra: {},
          provenance: { a: MANUAL_PROVENANCE, x: MANUAL_PROVENANCE },
          manualFields: ['a', 'x'],
        },
        { fields: { x: TEXT }, renames: new Map([['a', 'x']]) },
      ),
    ).toEqual({ ok: false, error: { manual: ['x'] } });
  });
});
