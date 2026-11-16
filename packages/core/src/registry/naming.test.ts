import { MAX_FIELD_NAME_LENGTH, MAX_SLUG_LENGTH, SCHEMA_LANGUAGES } from '@liasse/contract/domain';
import { describe, expect, it } from 'vitest';
import { CORE_FIELD_NAMES } from '@liasse/contract/registry';
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
      ['bill_september', 'september'],
      ['january_statement', 'january'],
    ])('rejects %s, which carries an English month', (slug, month) => {
      const violations = slugViolations(slug, KNOWN);
      expect(violations.map(({ rule }) => rule)).toEqual(['month']);
      expect(violations[0]?.message).toContain(`"${month}"`);
    });

    it('refuses the full name of every English month but May', () => {
      expect(MONTH_WORDS.en).toEqual([
        ...['january', 'february', 'march', 'april', 'june', 'july'],
        ...['august', 'september', 'october', 'november', 'december'],
      ]);
    });

    it.each([
      ['en', 'may'],
      ['en', 'mar'],
      ['en', 'dec'],
      ['en', 'bill_oct'],
      ['en', 'payslip_sept'],
      ['en', 'may_day_notice'],
      ['it', 'data_set'],
      ['it', 'ricevuta_ott'],
      ['es', 'seguro_mar'],
      ['es', 'recibo_dic'],
      ['fr', 'facture_fevr'],
      ['fr', 'bulletin_juil'],
      ['de', 'abrechnung_dez'],
    ] as const)('with %s, accepts %s: a short form is an ordinary word too', (language, slug) => {
      expect(slugRules(slug, { schemaLanguage: language })).toEqual([]);
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
      ['fr', 'facture_mai'],
      ['de', 'rechnung_oktober'],
      ['de', 'beleg_marz'],
      ['de', 'beleg_maerz'],
      ['es', 'factura_enero'],
      ['es', 'factura_mayo'],
      ['es', 'nomina_setiembre'],
      ['it', 'bolletta_gennaio'],
      ['it', 'cedolino_dicembre'],
    ] as const)('with %s, rejects %s', (schemaLanguage, slug) => {
      expect(slugRules(slug, { schemaLanguage })).toEqual(['month']);
      expect(slugRules(slug, { schemaLanguage: 'en' })).toEqual([]);
    });

    // Twelve names, less May in English, plus the second spelling of März and of
    // septiembre.
    it.each([
      ['en', 11],
      ['fr', 12],
      ['de', 13],
      ['es', 13],
      ['it', 12],
    ] as const)('has a table of the full month names for %s', (language, count) => {
      const months = MONTH_WORDS[language];
      expect(months).toHaveLength(count);
      expect(new Set(months).size).toBe(count);
      expect(months.filter((month) => !/^[a-z]+$/.test(month))).toEqual([]);
      months.forEach((month) => {
        expect(slugRules(`bill_${month}`, { schemaLanguage: language })).toEqual(['month']);
      });
    });

    it('has a table for every schema language', () => {
      expect(Object.keys(MONTH_WORDS)).toEqual([...SCHEMA_LANGUAGES]);
    });
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

    describe('of an organisation named with one word of two letters', () => {
      it('refuses that word as a whole word', () => {
        expect(slugRules('bp_invoice')).toEqual(['entity']);
        expect(slugRules('invoice_bp')).toEqual(['entity']);
        expect(slugRules('bp')).toEqual(['entity']);
        expect(slugViolations('bp_invoice', KNOWN)[0]?.message).toContain('"bp"');
      });

      it('reads the name without its legal form', () => {
        const withLegalForm = { entityNames: [{ kind: 'org', name: 'LG Corp.' }] } as const;
        expect(slugRules('lg_warranty', withLegalForm)).toEqual(['entity']);
      });

      it('does not match the word inside a longer word', () => {
        expect(slugRules('bpx_invoice')).toEqual([]);
        expect(slugRules('abp_invoice')).toEqual([]);
      });

      it('lets the word through once a type slug uses it', () => {
        expect(slugRules('bp_invoice', { typeSlugs: ['bp_statement'] })).toEqual([]);
      });

      it('leaves a two-letter word of a longer name insignificant', () => {
        const longer = {
          typeSlugs: [],
          entityNames: [
            { kind: 'org', name: 'HP Enterprise Services' },
            { kind: 'org', name: 'LG Chem' },
            { kind: 'org', name: 'BP BP' },
          ],
        } as const;
        expect(slugRules('hp_invoice', longer)).toEqual([]);
        expect(slugRules('lg_invoice', longer)).toEqual([]);
        expect(slugRules('bp_invoice', longer)).toEqual([]);
        expect(slugRules('chem_invoice', longer)).toEqual(['entity']);
      });

      it('does not apply to a person, to one letter or to a function word', () => {
        const others = {
          typeSlugs: [],
          entityNames: [
            { kind: 'person', name: 'Xi' },
            { kind: 'org', name: 'X' },
            { kind: 'org', name: 'The' },
          ],
        } as const;
        expect(slugRules('xi_report', others)).toEqual([]);
        expect(slugRules('x_report', others)).toEqual([]);
        expect(slugRules('the_report', others)).toEqual([]);
      });
    });

    it('ignores a name without any significant word', () => {
      expect(slugRules('id_of')).toEqual([]);
      expect(slugRules('sa_filing')).toEqual([]);
      expect(slugRules('of_the')).toEqual([]);
    });

    // A deliberate non-goal: a number spelled out is not looked for.
    it('accepts English number words', () => {
      expect(slugRules('bill_twenty_twenty_six')).toEqual([]);
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
