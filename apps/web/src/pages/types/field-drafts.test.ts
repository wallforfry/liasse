import { fieldDefinitionSchema } from '@liasse/contract/registry';
import { describe, expect, it } from 'vitest';
import { emptyField, type FieldDraft, fieldDefinition, fieldsOf } from './field-drafts.ts';

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

  it('drops the rows left unnamed and trims the names', () => {
    expect(
      fieldsOf([draft({ name: ' tenant ' }), draft({ key: 1, name: ' ', primitive: 'number' })]),
    ).toEqual({ tenant: { type: 'text' } });
  });
});
