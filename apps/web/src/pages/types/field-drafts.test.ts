import { fieldDefinitionSchema } from '@liasse/contract/registry';
import { describe, expect, it } from 'vitest';
import {
  emptyField,
  type FieldDraft,
  fieldDefinition,
  fieldDraftOf,
  fieldsOf,
  hasUnnamedRow,
} from './field-drafts.ts';

const draft = (overrides: Partial<FieldDraft>): FieldDraft => ({ ...emptyField(0), ...overrides });

describe('field drafts', () => {
  it.each([
    [{ primitive: 'money' }, { type: 'money' }],
    [
      { primitive: 'enum', values: ' gas, , electricity ' },
      { type: 'enum', values: ['gas', 'electricity'] },
    ],
    [
      { primitive: 'identifier', format: ' IBAN ' },
      { type: 'identifier', format: 'IBAN' },
    ],
    [{ primitive: 'identifier', format: ' ' }, { type: 'identifier' }],
    [
      { primitive: 'list', items: 'date' },
      { type: 'list', items: { type: 'date' } },
    ],
    [
      { primitive: 'list', items: 'enum', values: 'a,b' },
      { type: 'list', items: { type: 'enum', values: ['a', 'b'] } },
    ],
  ] as const)('turns %o into a definition of the contract', (overrides, expected) => {
    const definition = fieldDefinition(draft(overrides));
    expect(definition).toEqual(expected);
    expect(fieldDefinitionSchema.parse(definition)).toEqual(expected);
  });

  it.each([
    { type: 'money' },
    { type: 'enum', values: ['gas', 'electricity'] },
    { type: 'identifier', format: 'IBAN' },
    { type: 'identifier' },
    { type: 'list', items: { type: 'date' } },
    { type: 'list', items: { type: 'enum', values: ['a', 'b'] } },
  ] as const)('shows %o as a row that gives it back', (definition) => {
    const row = fieldDraftOf(3, 'amount', definition);
    expect(row).toMatchObject({ key: 3, name: 'amount' });
    expect(fieldDefinition(row)).toEqual(definition);
  });

  it('trims the names', () => {
    expect(fieldsOf([draft({ name: ' tenant ' })])).toEqual({ tenant: { type: 'text' } });
  });

  it('tells a row left unnamed', () => {
    expect(hasUnnamedRow([draft({ name: 'tenant' })])).toBe(false);
    expect(hasUnnamedRow([draft({ name: 'tenant' }), draft({ key: 1, name: ' ' })])).toBe(true);
  });
});
