import { MAX_ENUM_VALUE_LENGTH, MAX_FIELDS_PER_TYPE } from '@liasse/contract/domain';
import { describe, expect, it } from 'vitest';
import { checkTypeFields } from './fields.ts';

const ENERGY_BILL_FIELDS = {
  energy: { type: 'enum', values: ['electricity', 'gas', 'dual'] },
  meter_id: { type: 'identifier', format: 'PDL' },
  consumption_kwh: { type: 'number' },
  supply_address: { type: 'text' },
};

const manyFields = (count: number) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`field_${String(index)}`, { type: 'text' }]),
  );

const issuesOf = (input: unknown) => {
  const result = checkTypeFields(input);
  return result.ok ? [] : result.error.map(({ field, rule }) => ({ field, rule }));
};

describe('checkTypeFields', () => {
  it('accepts the fields of the specification example and returns them', () => {
    expect(checkTypeFields(ENERGY_BILL_FIELDS)).toEqual({ ok: true, value: ENERGY_BILL_FIELDS });
  });

  it('accepts a type without any field', () => {
    expect(checkTypeFields({})).toEqual({ ok: true, value: {} });
  });

  it.each([null, 'text', 12, [{ type: 'text' }]])('rejects %j, which is not an object', (input) => {
    expect(issuesOf(input)).toEqual([{ field: undefined, rule: 'not_an_object' }]);
  });

  it.each([new Date(0), new Map([['note', { type: 'text' }]])])(
    'rejects an object that is not a plain record',
    (input) => {
      expect(issuesOf(input)).toEqual([{ field: undefined, rule: 'not_an_object' }]);
    },
  );

  it('sees a field named __proto__ and refuses it, instead of dropping it', () => {
    const parsed: unknown = JSON.parse('{"__proto__": {"type": "text"}}');
    const computed = { ['__proto__']: { type: 'text' }, note: { type: 'text' } };
    expect(issuesOf(parsed)).toEqual([{ field: '__proto__', rule: 'snake_case' }]);
    expect(issuesOf(computed)).toEqual([{ field: '__proto__', rule: 'snake_case' }]);
  });

  it('accepts a field named constructor, which is snake_case, as an own field', () => {
    const result = checkTypeFields({ constructor: { type: 'text' } });
    expect(result.ok && Object.entries(result.value)).toEqual([['constructor', { type: 'text' }]]);
  });

  it(`caps a type at ${String(MAX_FIELDS_PER_TYPE)} fields`, () => {
    expect(checkTypeFields(manyFields(MAX_FIELDS_PER_TYPE)).ok).toBe(true);
    expect(issuesOf(manyFields(MAX_FIELDS_PER_TYPE + 1))).toEqual([
      { field: undefined, rule: 'too_many_fields' },
    ]);
  });

  it('rejects a field named like a core field', () => {
    expect(issuesOf({ amount: { type: 'money' } })).toEqual([
      { field: 'amount', rule: 'reserved' },
    ]);
  });

  it('rejects a field name that is not snake_case', () => {
    expect(issuesOf({ meterId: { type: 'identifier' } })).toEqual([
      { field: 'meterId', rule: 'snake_case' },
    ]);
  });

  it('rejects an invalid definition and says where it is wrong', () => {
    const result = checkTypeFields({ tags: { type: 'list', items: { type: 'list' } } });
    expect(result).toMatchObject({
      ok: false,
      error: [{ field: 'tags', rule: 'invalid_definition' }],
    });
    expect(result.ok ? '' : result.error[0]?.message).toContain('"tags.items.type"');
  });

  it('reports every broken rule in one pass', () => {
    expect(
      issuesOf({
        Bad: { type: 'object' },
        issuer: { type: 'entity' },
        energy: { type: 'enum', values: [] },
        fine: { type: 'text' },
      }),
    ).toEqual([
      { field: 'Bad', rule: 'snake_case' },
      { field: 'Bad', rule: 'invalid_definition' },
      { field: 'issuer', rule: 'reserved' },
      { field: 'energy', rule: 'invalid_definition' },
    ]);
  });

  // An enum value is a short label; a longer one is text no type should hold.
  it('refuses an enum value longer than a label, with a message that says the limit', () => {
    const checked = checkTypeFields({
      kind: { type: 'enum', values: ['income', 'x'.repeat(MAX_ENUM_VALUE_LENGTH + 1)] },
    });
    expect(checked).toMatchObject({
      ok: false,
      error: [{ field: 'kind', rule: 'invalid_definition' }],
    });
    expect(JSON.stringify(checked)).toContain(String(MAX_ENUM_VALUE_LENGTH));
    expect(
      checkTypeFields({ kind: { type: 'enum', values: ['x'.repeat(MAX_ENUM_VALUE_LENGTH)] } }).ok,
    ).toBe(true);
  });
});
