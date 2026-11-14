import { describe, expect, it } from 'vitest';
import { MANUAL_PROVENANCE } from '../domain/provenance.ts';
import { rehomeValues } from './rehome-values.ts';

const EXTRACTED = { model: 'm', schema_version: 1, confidence: 0.9, page: 1, quote: 'q' };

describe('rehomeValues', () => {
  it('makes a renamed value the field it fits, with its provenance and manual mark', () => {
    const moved = rehomeValues(
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
    const moved = rehomeValues(
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
    const moved = rehomeValues(
      { fields: {}, extra: { amount_due: 'twelve' }, provenance: {}, manualFields: [] },
      { fields: { amount: { type: 'number' } }, renames: new Map([['amount_due', 'amount']]) },
    );
    expect(moved).toMatchObject({ fields: {}, extra: { amount_due: 'twelve' } });
  });

  it('gives a field one value: a field wins over a variant of extra', () => {
    const moved = rehomeValues(
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
});
