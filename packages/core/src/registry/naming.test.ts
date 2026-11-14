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
    { kind: 'org', name: 'EDF' },
    { kind: 'org', name: 'Contract' },
    { kind: 'org', name: 'Free' },
    { kind: 'org', name: 'Crédit Agricole' },
    { kind: 'org', name: 'Acme Energy Services SA' },
    { kind: 'org', name: 'The Bank of the North' },
    { kind: 'org', name: 'BP' },
    { kind: 'org', name: '***' },
    { kind: 'person', name: 'Jane Doe' },
    { kind: 'person', name: 'Bill Stone' },
  ],
  typeSlugs: ['energy_bill', 'employment_contract'],
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

  describe('entity names', () => {
    describe('of a person', () => {
      it('refuses each significant word of the name as a whole word', () => {
        expect(slugRules('doe_contract')).toEqual(['entity']);
        expect(slugRules('jane_file')).toEqual(['entity']);
        expect(slugRules('stone_report')).toEqual(['entity']);
        expect(slugRules('jane_doe_payslip')).toEqual(['entity', 'entity']);
        expect(slugViolations('doe_contract', KNOWN)[0]?.message).toContain('"doe"');
      });

      it('does not match a word inside a longer word', () => {
        expect(slugRules('janet_file')).toEqual([]);
        expect(slugRules('doeskin_invoice')).toEqual([]);
      });

      it('lets a word through once a type slug uses it', () => {
        expect(slugRules('water_bill')).toEqual([]);
        expect(slugRules('water_bill', { typeSlugs: [] })).toEqual(['entity']);
      });
    });

    describe('of an organisation named with one significant word', () => {
      it('refuses that word as a whole word', () => {
        expect(slugRules('edf_bill')).toEqual(['entity']);
        expect(slugRules('bill_edf')).toEqual(['entity']);
        expect(slugRules('free_trial')).toEqual(['entity']);
        expect(slugViolations('edf_bill', KNOWN)[0]?.message).toContain('"edf"');
      });

      it('does not match a word inside a longer word, whatever its length', () => {
        expect(slugRules('edfbill')).toEqual([]);
        expect(slugRules('edfx_bill')).toEqual([]);
        expect(slugRules('freelance_agreement')).toEqual([]);
        expect(slugRules('contractor_invoice')).toEqual([]);
      });

      it('lets the word through once a type slug uses it', () => {
        expect(slugRules('contract')).toEqual([]);
        expect(slugRules('rental_contract')).toEqual([]);
      });

      it('holds the word back while no type slug uses it', () => {
        expect(slugRules('contract', { typeSlugs: [] })).toEqual(['entity']);
        expect(slugRules('edf_bill', { typeSlugs: ['edfx_bill', 'bill'] })).toEqual(['entity']);
      });
    });

    describe('of an organisation named with several significant words', () => {
      it('refuses the full name as a run of whole words', () => {
        expect(slugRules('credit_agricole_statement')).toEqual(['entity']);
        expect(slugRules('statement_credit_agricole')).toEqual(['entity']);
        expect(slugRules('acme_energy_services_invoice')).toEqual(['entity']);
        expect(slugRules('bank_of_the_north_statement')).toEqual(['entity']);
        expect(slugRules('the_bank_of_the_north')).toEqual(['entity']);
        expect(slugRules('bank_north_statement')).toEqual(['entity']);
        expect(slugViolations('credit_agricole_statement', KNOWN)[0]?.message).toContain(
          '"credit_agricole"',
        );
      });

      it('lets a single word of the name through, even before any type uses it', () => {
        const unused = {
          typeSlugs: [],
          entityNames: KNOWN.entityNames.filter(({ kind }) => kind === 'org'),
        };
        expect(slugRules('agricole_statement', unused)).toEqual([]);
        expect(slugRules('credit_note', unused)).toEqual([]);
        expect(slugRules('energy_bill', unused)).toEqual([]);
        expect(slugRules('services_agreement', unused)).toEqual([]);
      });

      it('lets a partial or reordered name through', () => {
        expect(slugRules('acme_energy_invoice')).toEqual([]);
        expect(slugRules('agricole_credit_statement')).toEqual([]);
        expect(slugRules('north_bank_statement')).toEqual([]);
        expect(slugRules('bank_loan_north_statement')).toEqual([]);
        expect(slugRules('credit_agricolex_statement')).toEqual([]);
      });

      it('refuses the full name even when type slugs use its words', () => {
        const used = { typeSlugs: ['credit_note', 'agricole_subsidy'] };
        expect(slugRules('credit_agricole_statement', used)).toEqual(['entity']);
      });
    });

    it('ignores a name without any significant word', () => {
      expect(slugRules('bp_invoice')).toEqual([]);
      expect(slugRules('bp')).toEqual([]);
      expect(slugRules('id_of')).toEqual([]);
      expect(slugRules('sa_filing')).toEqual([]);
    });

    it('accepts the same slug once the entity is unknown', () => {
      expect(slugRules('edf_bill', { entityNames: [] })).toEqual([]);
      expect(slugRules('doe_contract', { entityNames: [{ kind: 'org', name: 'EDF' }] })).toEqual(
        [],
      );
    });

    it('reads the kind: the same name refuses more as a person than as an organisation', () => {
      const asOrg = { entityNames: [{ kind: 'org', name: 'Jane Doe' }] } as const;
      expect(slugRules('doe_contract', asOrg)).toEqual([]);
      expect(slugRules('jane_doe_contract', asOrg)).toEqual(['entity']);
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
