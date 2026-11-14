import { EMPLOYER_SIRET, HOME_ADDRESS, IBAN_TAIL, JANE, PARTIES, SUBJECTS } from './cast.ts';
import { eur, frDate } from '../format.ts';
import { ADDRESSEE, letterhead, pdf, scannedPdf } from './layout.ts';
import {
  about,
  core,
  fact,
  field,
  keyDate,
  maskedField,
  money,
  noKeyDate,
  optional,
  required,
  type ScenarioDocument,
  truth,
} from './model.ts';
import { TYPES } from './types.ts';

const HIRED_ON = '2023-09-01';
const SIGNED_ON = '2023-08-28';
const PROBATION_END = '2023-12-31';
const BASE_SALARY = 3150;
const GROSS_NAMES = ['gross_pay', 'gross_salary', 'gross_amount', 'total_gross_pay'];
const NET_TAXABLE_NAMES = [
  'net_taxable',
  'net_taxable_income',
  'taxable_income',
  'taxable_net_pay',
];
const SOCIAL_SECURITY_TAIL = JANE.socialSecurityNumber.replace(/\s/g, '').slice(-4);

const employmentContract: ScenarioDocument = {
  id: 'employment-contract',
  description: 'Permanent employment contract between Jane Doe and Ostrelia Conseil',
  render: pdf([
    ...letterhead('employer'),
    'CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE',
    '',
    `Entre la société Ostrelia Conseil SAS, SIRET ${EMPLOYER_SIRET},`,
    'représentée par Mme Solène Abgrall, directrice générale,',
    `et Mme Jane Doe, demeurant ${HOME_ADDRESS}.`,
    '',
    'Article 1 - Engagement',
    `Mme Jane Doe est engagée à compter du ${frDate(HIRED_ON)} en qualité de`,
    'consultante en organisation, statut cadre.',
    '',
    "Article 2 - Période d'essai",
    `Le contrat comporte une période d'essai de quatre mois, soit jusqu'au`,
    `${frDate(PROBATION_END)}.`,
    '',
    'Article 3 - Durée du travail',
    'Temps plein, 35 heures par semaine.',
    '',
    'Article 4 - Rémunération',
    `Salaire brut mensuel : ${eur(BASE_SALARY)}, versé sur douze mois, auquel`,
    "s'ajoute une prime de fin d'année.",
    '',
    'Article 5 - Lieu de travail',
    'Port-Lanvec, avec deux jours de télétravail par semaine.',
    '',
    'Article 6 - Rupture du contrat',
    "Après la période d'essai, le préavis est de trois mois.",
    '',
    `Fait à Port-Lanvec, le ${frDate(SIGNED_ON)}, en deux exemplaires.`,
    'Pour la société : Solène Abgrall - La salariée : Jane Doe',
  ]),
  truth: truth({
    type: TYPES.employmentContract,
    core: core('fr', {
      document_date: required(SIGNED_ON, frDate(SIGNED_ON)),
      issuer: required(PARTIES.employer.key, PARTIES.employer.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: optional(money(BASE_SALARY), eur(BASE_SALARY)),
    }),
    fields: [
      field(
        ['gross_monthly_salary', 'monthly_gross_salary', 'gross_salary', 'salary'],
        'money',
        required(money(BASE_SALARY), eur(BASE_SALARY)),
      ),
      field(
        ['job_title', 'position', 'role'],
        'text',
        optional('consultante en organisation', 'consultante en organisation'),
      ),
      field(['notice_period_months', 'notice_period'], 'number', optional(3, 'trois mois')),
    ],
    key_dates: [
      keyDate('effective', HIRED_ON, frDate(HIRED_ON)),
      keyDate(['event', 'expiry'], PROBATION_END, frDate(PROBATION_END), 'optional'),
      noKeyDate('renewal', 'due'),
    ],
    subjects: [about(SUBJECTS.employment)],
    facts: [
      fact('Jane Doe has worked for Ostrelia Conseil on a permanent contract since 2023-09-01.', {
        entities: [PARTIES.employer.key],
        dates: [HIRED_ON],
      }),
      fact(
        'Her gross monthly salary is 3150 EUR.',
        { entities: [PARTIES.employer.key], amounts: [money(BASE_SALARY)] },
        'optional',
      ),
    ],
  }),
};

interface Payslip {
  readonly id: string;
  readonly month: string;
  readonly period: readonly [start: string, end: string];
  readonly paidOn: string;
  readonly bonus: number;
  readonly contributions: number;
  readonly netTaxable: number;
  readonly taxWithheld: number;
  readonly cumulativeNetTaxable: number;
  readonly scanned?: boolean;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const payslip = (slip: Payslip): ScenarioDocument => {
  const [start, end] = slip.period;
  const gross = BASE_SALARY + slip.bonus;
  const netPaid = round2(gross - slip.contributions - slip.taxWithheld);
  const lines = [
    ...letterhead('employer'),
    `BULLETIN DE PAIE - ${slip.month}`,
    `Période du ${frDate(start)} au ${frDate(end)}`,
    `Date de paiement : ${frDate(slip.paidOn)}`,
    `Employeur : SIRET ${EMPLOYER_SIRET}`,
    '',
    `Salariée : Mme Jane Doe - Matricule ${JANE.employeeNumber}`,
    `N° de sécurité sociale : ${JANE.socialSecurityNumber}`,
    'Emploi : consultante en organisation - statut cadre',
    `Entrée dans l'entreprise : ${frDate(HIRED_ON)}`,
    '',
    `Salaire de base : ${eur(BASE_SALARY)}`,
    ...(slip.bonus === 0 ? [] : [`Prime de fin d'année : ${eur(slip.bonus)}`]),
    `Salaire brut : ${eur(gross)}`,
    `Cotisations et contributions salariales : - ${eur(slip.contributions)}`,
    `Net à payer avant impôt sur le revenu : ${eur(round2(gross - slip.contributions))}`,
    `Net imposable : ${eur(slip.netTaxable)}`,
    `Impôt sur le revenu prélevé à la source (taux 2,0 %) : - ${eur(slip.taxWithheld)}`,
    '',
    `Net payé : ${eur(netPaid)}`,
    `Versement par virement sur le compte se terminant par ${IBAN_TAIL}`,
    '',
    `Cumul net imposable depuis le 1er janvier : ${eur(slip.cumulativeNetTaxable)}`,
    'Conservez ce bulletin de paie sans limitation de durée.',
  ];
  return {
    id: slip.id,
    description: `Payslip from Ostrelia Conseil for ${start.slice(0, 7)}${slip.scanned === true ? ', scanned' : ''}`,
    render: slip.scanned === true ? scannedPdf('scan', lines) : pdf(lines),
    truth: truth({
      type: TYPES.payslip,
      hard_cases: ['sensitive_identifiers'],
      core: core('fr', {
        document_date: required(slip.paidOn, frDate(slip.paidOn), [end]),
        issuer: required(PARTIES.employer.key, PARTIES.employer.printed),
        recipient: required(PARTIES.jane.key, 'Jane Doe'),
        amount: required(money(netPaid), `Net payé : ${eur(netPaid)}`),
        period: required({ start, end }, `du ${frDate(start)} au ${frDate(end)}`),
      }),
      fields: [
        field(GROSS_NAMES, 'money', required(money(gross), `Salaire brut : ${eur(gross)}`)),
        field(
          NET_TAXABLE_NAMES,
          'money',
          optional(money(slip.netTaxable), `Net imposable : ${eur(slip.netTaxable)}`),
        ),
        field(
          ['income_tax_withheld', 'withholding_tax', 'tax_withheld'],
          'money',
          optional(money(slip.taxWithheld), eur(slip.taxWithheld)),
        ),
        field(
          ['employee_number', 'employee_id'],
          'identifier',
          optional(JANE.employeeNumber, JANE.employeeNumber),
        ),
        maskedField(
          ['social_security_number', 'national_insurance_number'],
          SOCIAL_SECURITY_TAIL,
          JANE.socialSecurityNumber,
          'optional',
        ),
      ],
      key_dates: [noKeyDate('due', 'expiry', 'renewal')],
      subjects: [about(SUBJECTS.employment), about(SUBJECTS.bankAccount, 'optional')],
      facts: [
        fact(
          `Ostrelia Conseil paid Jane Doe ${String(netPaid)} EUR net for ${start.slice(0, 7)}.`,
          {
            entities: [PARTIES.employer.key],
            amounts: [money(netPaid)],
          },
        ),
      ],
      masking: [
        {
          kind: 'social_security_number',
          clear: JANE.socialSecurityNumber,
          visible_tail: SOCIAL_SECURITY_TAIL,
        },
      ],
      private: 'optional',
    }),
  };
};

const YEAR_GROSS = 38550;
const YEAR_NET_TAXABLE = 31170.5;
const YEAR_TAX_WITHHELD = 623.41;
const YEAR_NET_PAID = 29522.69;
const SUMMARY_DATE = '2026-01-08';

const paySummary: ScenarioDocument = {
  id: 'pay-summary-2025',
  description: 'Year-end summary of the pay of 2025 from Ostrelia Conseil',
  render: pdf([
    ...letterhead('employer'),
    ...ADDRESSEE,
    'RÉCAPITULATIF ANNUEL DES RÉMUNÉRATIONS - ANNÉE 2025',
    `Port-Lanvec, le ${frDate(SUMMARY_DATE)}`,
    '',
    `Salariée : Mme Jane Doe - Matricule ${JANE.employeeNumber}`,
    `Période : du ${frDate('2025-01-01')} au ${frDate('2025-12-31')}`,
    'Nombre de bulletins de paie : 12',
    '',
    `Salaire brut total : ${eur(YEAR_GROSS)}`,
    `Net imposable total : ${eur(YEAR_NET_TAXABLE)}`,
    `Impôt sur le revenu prélevé à la source : ${eur(YEAR_TAX_WITHHELD)}`,
    `Net payé total : ${eur(YEAR_NET_PAID)}`,
    '',
    'Ce récapitulatif reprend les montants de vos douze bulletins de paie',
    "de l'année. Le net imposable est le montant repris dans votre",
    'déclaration de revenus.',
    '',
    'Le service des ressources humaines',
  ]),
  truth: truth({
    type: TYPES.paySummary,
    core: core('fr', {
      document_date: required(SUMMARY_DATE, frDate(SUMMARY_DATE)),
      issuer: required(PARTIES.employer.key, PARTIES.employer.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(YEAR_NET_PAID), eur(YEAR_NET_PAID), [
        money(YEAR_NET_TAXABLE),
        money(YEAR_GROSS),
      ]),
      period: required(
        { start: '2025-01-01', end: '2025-12-31' },
        `du ${frDate('2025-01-01')} au ${frDate('2025-12-31')}`,
      ),
    }),
    fields: [
      field(
        [...GROSS_NAMES, 'annual_gross_salary'],
        'money',
        required(money(YEAR_GROSS), eur(YEAR_GROSS)),
      ),
      field(
        [...NET_TAXABLE_NAMES, 'total_net_taxable'],
        'money',
        required(money(YEAR_NET_TAXABLE), eur(YEAR_NET_TAXABLE)),
      ),
      field(
        ['income_tax_withheld', 'withholding_tax', 'tax_withheld'],
        'money',
        optional(money(YEAR_TAX_WITHHELD), eur(YEAR_TAX_WITHHELD)),
      ),
    ],
    key_dates: [noKeyDate('due', 'expiry', 'renewal')],
    subjects: [about(SUBJECTS.employment)],
    facts: [
      fact('In 2025 Ostrelia Conseil paid Jane Doe 29522.69 EUR net; 31170.50 EUR were taxable.', {
        entities: [PARTIES.employer.key],
        amounts: [money(YEAR_NET_PAID), money(YEAR_NET_TAXABLE)],
      }),
    ],
    private: 'optional',
  }),
};

const MONTHLY = { bonus: 0, contributions: 686.7, netTaxable: 2547, taxWithheld: 50.94 } as const;

export const WORK_DOCUMENTS: readonly ScenarioDocument[] = [
  employmentContract,
  payslip({
    id: 'payslip-2025-10',
    month: 'Octobre 2025',
    period: ['2025-10-01', '2025-10-31'],
    paidOn: '2025-10-30',
    ...MONTHLY,
    cumulativeNetTaxable: 25470,
    scanned: true,
  }),
  payslip({
    id: 'payslip-2025-11',
    month: 'Novembre 2025',
    period: ['2025-11-01', '2025-11-30'],
    paidOn: '2025-11-28',
    ...MONTHLY,
    cumulativeNetTaxable: 28017,
  }),
  payslip({
    id: 'payslip-2025-12',
    month: 'Décembre 2025',
    period: ['2025-12-01', '2025-12-31'],
    paidOn: '2025-12-30',
    bonus: 750,
    contributions: 850.2,
    netTaxable: 3153.5,
    taxWithheld: 63.07,
    cumulativeNetTaxable: YEAR_NET_TAXABLE,
  }),
  paySummary,
];
