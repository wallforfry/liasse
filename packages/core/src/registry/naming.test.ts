import { describe, expect, it } from 'vitest';
import { MAX_FIELD_NAME_LENGTH, MAX_SLUG_LENGTH } from '../domain/limits.ts';
import { CORE_FIELD_NAMES } from './core-fields.ts';
import { aliasViolations, fieldNameViolations, slugViolations } from './naming.ts';

const ENTITIES = [['edf'], ['synthetic', 'energy'], []];

const slugRules = (slug: string, entities: readonly (readonly string[])[] = ENTITIES) =>
  slugViolations(slug, entities).map(({ rule }) => rule);

const fieldRules = (name: string) => fieldNameViolations(name).map(({ rule }) => rule);

describe('slugViolations', () => {
  it.each(['energy_bill', 'bill', 'employment_contract', 'tax_notice'])('accepts %s', (slug) => {
    expect(slugViolations(slug, ENTITIES)).toEqual([]);
  });

  it.each([
    'EnergyBill',
    'energy-bill',
    'energy bill',
    'energy__bill',
    '_energy_bill',
    'energy_bill_',
    'facture_énergie',
    '',
  ])('rejects %s, which is not snake_case ASCII', (slug) => {
    expect(slugRules(slug)).toEqual(['snake_case']);
  });

  it(`caps a slug at ${String(MAX_SLUG_LENGTH)} characters`, () => {
    expect(slugRules('a'.repeat(MAX_SLUG_LENGTH))).toEqual([]);
    expect(slugRules('a'.repeat(MAX_SLUG_LENGTH + 1))).toEqual(['too_long']);
  });

  it.each(['bill_2026', 'tax_notice_2025_10', 'invoice_84', 'q3_report', 'form_w2'])(
    'rejects %s, which carries a digit',
    (slug) => {
      expect(slugRules(slug)).toEqual(['digit']);
    },
  );

  it.each([
    ['october_bill', 'october'],
    ['bill_oct', 'oct'],
    ['payslip_sept', 'sept'],
    ['january_statement', 'january'],
  ])('rejects %s, which carries a month', (slug, month) => {
    const violations = slugViolations(slug, ENTITIES);
    expect(violations.map(({ rule }) => rule)).toEqual(['month']);
    expect(violations[0]?.message).toContain(`"${month}"`);
  });

  it('does not take a word that merely contains a month for a month', () => {
    expect(slugRules('mayor_decree')).toEqual([]);
    expect(slugRules('decree')).toEqual([]);
  });

  it('rejects the example of the specification on both counts', () => {
    expect(slugRules('edf_october')).toEqual(['month', 'entity']);
  });

  it('rejects a slug that contains the name of a known entity', () => {
    expect(slugRules('edf_bill')).toEqual(['entity']);
    expect(slugRules('bill_edf')).toEqual(['entity']);
    expect(slugRules('synthetic_energy_bill')).toEqual(['entity']);
    expect(slugViolations('edf_bill', ENTITIES)[0]?.message).toContain('"edf"');
  });

  it('matches an entity on whole words, in order', () => {
    expect(slugRules('energy_bill')).toEqual([]);
    expect(slugRules('energy_synthetic_bill')).toEqual([]);
    expect(slugRules('edfx_bill')).toEqual([]);
  });

  it('accepts the same slug once the entity is unknown', () => {
    expect(slugRules('edf_bill', [])).toEqual([]);
  });
});

describe('fieldNameViolations', () => {
  it.each(['meter_id', 'consumption_kwh', 'address_line_2', 'co2_emissions'])(
    'accepts %s',
    (name) => {
      expect(fieldNameViolations(name)).toEqual([]);
    },
  );

  it.each(['meterId', 'meter-id', '2nd_address', 'meter__id', 'numéro', ''])(
    'rejects %s, which is not snake_case ASCII',
    (name) => {
      expect(fieldRules(name)).toEqual(['snake_case']);
    },
  );

  it(`caps a field name at ${String(MAX_FIELD_NAME_LENGTH)} characters`, () => {
    expect(fieldRules('a'.repeat(MAX_FIELD_NAME_LENGTH))).toEqual([]);
    expect(fieldRules('a'.repeat(MAX_FIELD_NAME_LENGTH + 1))).toEqual(['too_long']);
  });

  it.each(CORE_FIELD_NAMES)('reserves the core field %s', (name) => {
    expect(fieldRules(name)).toEqual(['reserved']);
  });

  it('knows the nine fields of the common core', () => {
    expect(CORE_FIELD_NAMES).toEqual([
      'document_date',
      'issuer',
      'recipient',
      'amount',
      'period',
      'due_date',
      'reference',
      'language',
      'key_dates',
    ]);
  });
});

describe('aliasViolations', () => {
  it('only asks an alias to look like a slug', () => {
    expect(aliasViolations('edf_bill')).toEqual([]);
    expect(aliasViolations('bill_2026')).toEqual([]);
    expect(aliasViolations('EDF bill').map(({ rule }) => rule)).toEqual(['snake_case']);
    expect(aliasViolations('a'.repeat(MAX_SLUG_LENGTH + 1)).map(({ rule }) => rule)).toEqual([
      'too_long',
    ]);
  });
});
