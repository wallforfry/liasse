import { describe, expect, it } from 'vitest';
import { SCHEMA_LANGUAGES } from '../domain/enums.ts';
import { MAX_FIELD_NAME_LENGTH, MAX_SLUG_LENGTH } from '../domain/limits.ts';
import { CORE_FIELD_NAMES } from './core-fields.ts';
import {
  aliasViolations,
  fieldNameViolations,
  MONTH_WORDS,
  type SlugContext,
  slugViolations,
} from './naming.ts';

const KNOWN: SlugContext = {
  schemaLanguage: 'en',
  entityNames: [
    'EDF',
    'Synthetic Energy SA',
    'Jane Doe',
    'Crédit Agricole',
    'Contract',
    'Vela',
    'Nordwind',
    'Acme Widgets GmbH',
    'The Bank of the North',
    '***',
  ],
  typeSlugs: ['energy_bill', 'employment_contract', 'credit_note'],
};

const slugRules = (slug: string, context: Partial<SlugContext> = {}) =>
  slugViolations(slug, { ...KNOWN, ...context }).map(({ rule }) => rule);

const fieldRules = (name: string) => fieldNameViolations(name).map(({ rule }) => rule);

describe('slugViolations', () => {
  it.each(['energy_bill', 'bill', 'employment_contract', 'tax_notice'])('accepts %s', (slug) => {
    expect(slugViolations(slug, KNOWN)).toEqual([]);
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

  describe('date words', () => {
    it.each([
      ['october_bill', 'october'],
      ['bill_oct', 'oct'],
      ['payslip_sept', 'sept'],
      ['january_statement', 'january'],
    ])('rejects %s, which carries an English month', (slug, month) => {
      const violations = slugViolations(slug, KNOWN);
      expect(violations.map(({ rule }) => rule)).toEqual(['month']);
      expect(violations[0]?.message).toContain(`"${month}"`);
    });

    it('does not take a word that merely contains a month for a month', () => {
      expect(slugRules('mayor_decree')).toEqual([]);
      expect(slugRules('decree')).toEqual([]);
    });

    it('refuses the months of the schema language, on top of the English ones', () => {
      expect(slugRules('bill_octobre', { schemaLanguage: 'fr' })).toEqual(['month']);
      expect(slugRules('energy_bill', { schemaLanguage: 'fr' })).toEqual([]);
      expect(slugRules('october_bill', { schemaLanguage: 'fr' })).toEqual(['month']);
    });

    it('leaves the months of a language that is not configured alone', () => {
      expect(slugRules('bill_octobre')).toEqual([]);
      expect(slugRules('bill_octobre', { schemaLanguage: 'de' })).toEqual([]);
      expect(slugRules('rechnung_oktober', { schemaLanguage: 'fr' })).toEqual([]);
    });

    it.each([
      ['fr', 'facture_janvier'],
      ['fr', 'releve_aout'],
      ['fr', 'facture_fevr'],
      ['fr', 'bulletin_juil'],
      ['de', 'rechnung_oktober'],
      ['de', 'beleg_marz'],
      ['de', 'abrechnung_dez'],
      ['es', 'factura_enero'],
      ['es', 'recibo_dic'],
      ['es', 'nomina_setiembre'],
      ['it', 'bolletta_gennaio'],
      ['it', 'ricevuta_ott'],
      ['it', 'cedolino_dicembre'],
    ] as const)('with %s, rejects %s', (schemaLanguage, slug) => {
      expect(slugRules(slug, { schemaLanguage })).toEqual(['month']);
      expect(slugRules(slug, { schemaLanguage: 'en' })).toEqual([]);
    });

    it.each(SCHEMA_LANGUAGES)(
      'has a table of twelve months and their short forms for %s',
      (language) => {
        const months = MONTH_WORDS[language];
        expect(months.length).toBeGreaterThanOrEqual(12);
        expect(months.filter((month) => !/^[a-z]+$/.test(month))).toEqual([]);
        months.forEach((month) => {
          expect(slugRules(`bill_${month}`, { schemaLanguage: language })).toEqual(['month']);
        });
      },
    );
  });

  it('rejects the example of the specification on both counts', () => {
    expect(slugRules('edf_october')).toEqual(['month', 'entity']);
  });

  describe('entity words', () => {
    it('rejects a slug that carries a word of a known entity name', () => {
      expect(slugRules('edf_bill')).toEqual(['entity']);
      expect(slugRules('bill_edf')).toEqual(['entity']);
      expect(slugViolations('edf_bill', KNOWN)[0]?.message).toContain('"edf"');
    });

    it('matches each significant word of the name, not only the whole name', () => {
      expect(slugRules('doe_contract')).toEqual(['entity']);
      expect(slugRules('jane_file')).toEqual(['entity']);
      expect(slugRules('agricole_statement')).toEqual(['entity']);
      expect(slugRules('synthetic_report')).toEqual(['entity']);
      expect(slugRules('jane_doe_payslip')).toEqual(['entity', 'entity']);
    });

    it('ignores the legal form, the function words and the words under three characters', () => {
      expect(slugRules('gmbh_register')).toEqual([]);
      expect(slugRules('the_ledger')).toEqual([]);
      expect(slugRules('of_record')).toEqual([]);
      expect(slugRules('sa_filing')).toEqual([]);
    });

    it('matches a short entity word on whole words only', () => {
      expect(slugRules('edfbill')).toEqual([]);
      expect(slugRules('edfx_bill')).toEqual([]);
      expect(slugRules('vela_note')).toEqual(['entity']);
      expect(slugRules('velar_note')).toEqual([]);
    });

    it('matches an entity word of six characters or more inside a longer word', () => {
      expect(slugRules('nordwindbill')).toEqual(['entity']);
      expect(slugRules('bill_fromnordwind')).toEqual(['entity']);
      expect(slugRules('agricolestatement')).toEqual(['entity']);
    });

    it('lets a word through once a type slug already uses it', () => {
      expect(slugRules('contract')).toEqual([]);
      expect(slugRules('rental_contract')).toEqual([]);
      expect(slugRules('energy_report')).toEqual([]);
      expect(slugRules('credit_agreement')).toEqual([]);
    });

    it('holds the same word back while no type slug uses it', () => {
      const unused = { typeSlugs: [] };
      expect(slugRules('contract', unused)).toEqual(['entity']);
      expect(slugRules('energy_report', unused)).toEqual(['entity']);
      expect(slugRules('credit_agreement', unused)).toEqual(['entity']);
    });

    it('never lets a type slug free a word it only contains', () => {
      expect(slugRules('edf_bill', { typeSlugs: ['edfx_bill', 'bill'] })).toEqual(['entity']);
    });

    it('accepts the same slug once the entity is unknown', () => {
      expect(slugRules('edf_bill', { entityNames: [] })).toEqual([]);
      expect(slugRules('doe_contract', { entityNames: ['EDF'] })).toEqual([]);
    });
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
