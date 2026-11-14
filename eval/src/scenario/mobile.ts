import { seededDigits } from '../identifiers.ts';
import { CONTRACTS, HOME_ADDRESS, IBAN_TAIL, JANE, PARTIES, SUBJECTS } from './cast.ts';
import { eur, frDate } from '../format.ts';
import { ADDRESSEE, letterhead, pdf, SENDER } from './layout.ts';
import {
  about,
  core,
  fact,
  field,
  keyDate,
  link,
  money,
  optional,
  required,
  type ScenarioDocument,
  truth,
} from './model.ts';
import { TYPES } from './types.ts';

const TELORCA_CONTACT = 'Service clients : 01 99 00 63 10';
const TELORCA_CUSTOMER = `T${seededDigits('telorca-customer', 8)}`;
const PLAN = 'Horizon 60 Go';
const PLAN_PRICE = 19.99;
const SUBSCRIBED_ON = '2024-02-10';
const COMMITMENT_END = '2026-02-09';
const TERMINATION_LETTER_DATE = '2025-11-20';
const TERMINATION_DATE = '2025-12-31';
const TERMINATION_FEE = 9.99;

const phoneField = field(
  ['phone_number', 'line_number', 'mobile_number'],
  'identifier',
  required(JANE.mobile, JANE.mobile),
);

const mobileContract: ScenarioDocument = {
  id: 'mobile-contract',
  description: 'Mobile plan contract with Telorca, with a 24-month commitment',
  render: pdf([
    ...letterhead('telorca', TELORCA_CONTACT),
    "CONTRAT D'ABONNEMENT MOBILE",
    `Contrat n° ${CONTRACTS.mobile}`,
    `Souscrit le ${frDate(SUBSCRIBED_ON)} en boutique Telorca de Valmont-sur-Orbe`,
    '',
    'Titulaire : Mme Jane Doe',
    `Adresse : ${HOME_ADDRESS}`,
    `Référence client : ${TELORCA_CUSTOMER}`,
    `Ligne : ${JANE.mobile}`,
    `Forfait : ${PLAN} - appels, SMS et MMS illimités en France`,
    `Prix : ${eur(PLAN_PRICE)} TTC par mois, facturé au début du mois suivant`,
    '',
    `Date d'activation de la ligne : ${frDate(SUBSCRIBED_ON)}`,
    `Durée d'engagement : 24 mois, soit jusqu'au ${frDate(COMMITMENT_END)}`,
    "Au terme de l'engagement, le contrat se poursuit sans durée déterminée.",
    '',
    'Résiliation : par lettre recommandée adressée au service clients, avec',
    "un préavis de dix jours. Avant le terme de l'engagement, des frais de",
    "résiliation peuvent s'appliquer.",
    '',
    `Paiement par prélèvement automatique, compte se terminant par ${IBAN_TAIL}.`,
    'Signature du titulaire : Jane Doe',
  ]),
  truth: truth({
    type: TYPES.mobileContract,
    core: core('fr', {
      document_date: required(SUBSCRIBED_ON, frDate(SUBSCRIBED_ON)),
      issuer: required(PARTIES.telorca.key, PARTIES.telorca.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: optional(money(PLAN_PRICE), eur(PLAN_PRICE)),
      reference: required(CONTRACTS.mobile, CONTRACTS.mobile),
    }),
    fields: [
      phoneField,
      field(['commitment_months', 'commitment_duration_months'], 'number', optional(24, '24 mois')),
      field(
        ['monthly_price', 'monthly_fee'],
        'money',
        optional(money(PLAN_PRICE), eur(PLAN_PRICE)),
      ),
    ],
    key_dates: [
      keyDate('effective', SUBSCRIBED_ON, frDate(SUBSCRIBED_ON)),
      keyDate('expiry', COMMITMENT_END, frDate(COMMITMENT_END)),
    ],
    subjects: [about(SUBJECTS.mobilePlan)],
    facts: [
      fact(
        'The Telorca mobile plan costs 19.99 EUR per month, with a commitment until 2026-02-09.',
        { entities: [PARTIES.telorca.key], amounts: [money(PLAN_PRICE)], dates: [COMMITMENT_END] },
      ),
    ],
  }),
};

interface MobileBill {
  readonly id: string;
  readonly issued: string;
  readonly period: readonly [start: string, end: string];
  readonly due: string;
  readonly extras: number;
  // The email of the scenario that carries the bill, when it has no file of its own.
  readonly attachedTo?: string;
}

const billNumber = (prefix: string, id: string, issued: string): string =>
  `${prefix}-F-${issued.slice(0, 7)}-${seededDigits(id, 5)}`;

const mobileBill = (bill: MobileBill): ScenarioDocument => {
  const [start, end] = bill.period;
  const number = billNumber('TM', bill.id, bill.issued);
  const amount = Math.round((PLAN_PRICE + bill.extras) * 100) / 100;
  return {
    id: bill.id,
    description: `Telorca mobile bill for ${start} to ${end}${bill.attachedTo === undefined ? '' : ', received as an email attachment'}`,
    render: pdf([
      ...letterhead('telorca', TELORCA_CONTACT),
      `FACTURE MOBILE N° ${number}`,
      `Date de facture : ${frDate(bill.issued)}`,
      '',
      'Titulaire : Mme Jane Doe',
      `Référence client : ${TELORCA_CUSTOMER} - Contrat n° ${CONTRACTS.mobile}`,
      `Ligne : ${JANE.mobile} - Forfait ${PLAN}`,
      '',
      `Période facturée : du ${frDate(start)} au ${frDate(end)}`,
      '',
      `Forfait ${PLAN} : ${eur(PLAN_PRICE)}`,
      `Communications hors forfait : ${eur(bill.extras)}`,
      `Total TTC à payer : ${eur(amount)}`,
      '',
      `Prélèvement le ${frDate(bill.due)} sur le compte se terminant par ${IBAN_TAIL}.`,
      'Le détail de vos communications est disponible dans votre espace client.',
      '',
      'Telorca SAS - service.clients@telorca.example - www.telorca.example',
    ]),
    truth: truth({
      type: TYPES.mobileBill,
      hard_cases: bill.attachedTo === undefined ? [] : ['email_attachment'],
      core: core('fr', {
        document_date: required(bill.issued, frDate(bill.issued)),
        issuer: required(PARTIES.telorca.key, PARTIES.telorca.printed),
        recipient: required(PARTIES.jane.key, 'Jane Doe'),
        amount: required(money(amount), `Total TTC à payer : ${eur(amount)}`),
        period: required({ start, end }, `du ${frDate(start)} au ${frDate(end)}`),
        due_date: required(bill.due, frDate(bill.due)),
        reference: required(number, number),
      }),
      fields: [
        phoneField,
        field(
          ['customer_number', 'customer_reference', 'customer_id'],
          'identifier',
          optional(TELORCA_CUSTOMER, TELORCA_CUSTOMER),
        ),
      ],
      key_dates: [keyDate('due', bill.due, frDate(bill.due))],
      links: bill.attachedTo === undefined ? [] : [link('attachment_of', bill.attachedTo)],
      subjects: [about(SUBJECTS.mobilePlan)],
      facts: [
        fact(`Telorca billed ${String(amount)} EUR for the mobile plan of ${start} to ${end}.`, {
          entities: [PARTIES.telorca.key],
          amounts: [money(amount)],
        }),
      ],
    }),
  };
};

const BILL_EMAIL_ID = 'mobile-bill-email-2025-11';

const NOVEMBER_BILL = mobileBill({
  id: 'mobile-bill-2025-11',
  issued: '2025-11-03',
  period: ['2025-10-01', '2025-10-31'],
  due: '2025-11-13',
  extras: 0,
  attachedTo: BILL_EMAIL_ID,
});

const novemberBillNumber = billNumber('TM', NOVEMBER_BILL.id, '2025-11-03');

const billEmail: ScenarioDocument = {
  id: BILL_EMAIL_ID,
  description:
    'Email from Telorca announcing the November 2025 bill, with the bill attached as a PDF',
  render: {
    kind: 'eml',
    from: { name: 'Telorca', address: 'facture@telorca.example' },
    to: { name: 'Jane Doe', address: JANE.email },
    date: 'Mon, 03 Nov 2025 09:12:00 +0100',
    subject: 'Votre facture Telorca de novembre 2025 est disponible',
    lines: [
      'Bonjour Jane Doe,',
      '',
      `Votre facture mobile n° ${novemberBillNumber} du ${frDate('2025-11-03')} est disponible.`,
      'Vous la trouverez en pièce jointe de ce message.',
      '',
      `Montant : ${eur(PLAN_PRICE)}`,
      `Prélèvement prévu le ${frDate('2025-11-13')}`,
      `Ligne : ${JANE.mobile}`,
      '',
      "Vous n'avez rien à faire : le montant sera prélevé automatiquement.",
      '',
      "L'équipe Telorca",
      'Ce message est envoyé automatiquement, merci de ne pas y répondre.',
    ],
    attachments: [{ filename: `facture-${novemberBillNumber}.pdf`, document: NOVEMBER_BILL.id }],
  },
  truth: truth({
    type: TYPES.billEmail,
    hard_cases: ['email_attachment'],
    core: core('fr', {
      document_date: required('2025-11-03', frDate('2025-11-03')),
      issuer: required(PARTIES.telorca.key, 'Telorca'),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: optional(money(PLAN_PRICE), eur(PLAN_PRICE)),
      due_date: optional('2025-11-13', frDate('2025-11-13')),
      reference: optional(novemberBillNumber, novemberBillNumber),
    }),
    fields: [{ ...phoneField, expectation: optional(JANE.mobile, JANE.mobile) }],
    subjects: [about(SUBJECTS.mobilePlan, 'optional')],
    facts: [
      fact(
        'Telorca announced the mobile bill of November 2025, 19.99 EUR, debited on 2025-11-13.',
        {
          entities: [PARTIES.telorca.key],
          amounts: [money(PLAN_PRICE)],
        },
      ),
    ],
  }),
};

const terminationLetter: ScenarioDocument = {
  id: 'mobile-termination-letter',
  description: 'Letter from Jane Doe asking Telorca to terminate the mobile contract, as a DOCX',
  render: {
    kind: 'docx',
    lines: [
      ...SENDER,
      'Telorca - Service clients',
      '27 avenue des Câbliers, 99410 Sainte-Orme',
      '',
      `Valmont-sur-Orbe, le ${frDate(TERMINATION_LETTER_DATE)}`,
      'Lettre recommandée avec accusé de réception',
      '',
      `Objet : résiliation du contrat mobile n° ${CONTRACTS.mobile}`,
      '',
      'Madame, Monsieur,',
      `Je vous demande de résilier mon contrat d'abonnement mobile n° ${CONTRACTS.mobile}, ligne ${JANE.mobile}, souscrit le ${frDate(SUBSCRIBED_ON)}.`,
      `Je souhaite que la résiliation prenne effet le ${frDate(TERMINATION_DATE)}. Je ne souhaite pas conserver ce numéro.`,
      "Je vous remercie de m'adresser une confirmation écrite ainsi que la facture de clôture.",
      'Veuillez agréer, Madame, Monsieur, mes salutations distinguées.',
      '',
      'Jane Doe',
    ],
  },
  truth: truth({
    type: TYPES.terminationLetter,
    core: core('fr', {
      document_date: required(TERMINATION_LETTER_DATE, frDate(TERMINATION_LETTER_DATE)),
      issuer: required(PARTIES.jane.key, 'Jane Doe'),
      recipient: required(PARTIES.telorca.key, 'Telorca'),
      reference: optional(CONTRACTS.mobile, CONTRACTS.mobile),
    }),
    fields: [{ ...phoneField, expectation: optional(JANE.mobile, JANE.mobile) }],
    key_dates: [
      keyDate(['expiry', 'effective', 'event'], TERMINATION_DATE, frDate(TERMINATION_DATE)),
    ],
    links: [link('terminates', mobileContract.id)],
    subjects: [about(SUBJECTS.mobilePlan)],
    facts: [
      fact('Jane Doe asked Telorca to terminate the mobile contract with effect on 2025-12-31.', {
        entities: [PARTIES.telorca.key],
        dates: [TERMINATION_DATE],
      }),
    ],
  }),
};

const CASE_NUMBER = `RES-2025-${seededDigits('telorca-termination', 5)}`;

const terminationConfirmation: ScenarioDocument = {
  id: 'mobile-termination-confirmation',
  description: 'Letter from Telorca confirming the termination of the mobile contract',
  render: pdf([
    ...letterhead('telorca', TELORCA_CONTACT),
    ...ADDRESSEE,
    `Sainte-Orme, le ${frDate('2025-11-27')}`,
    '',
    `Objet : confirmation de résiliation - contrat n° ${CONTRACTS.mobile}`,
    `Référence dossier : ${CASE_NUMBER}`,
    '',
    'Madame,',
    '',
    `Nous avons bien reçu votre lettre du ${frDate(TERMINATION_LETTER_DATE)} demandant la`,
    `résiliation de votre contrat mobile, ligne ${JANE.mobile}.`,
    '',
    `Votre contrat sera résilié le ${frDate(TERMINATION_DATE)}. À cette date, la ligne sera`,
    'désactivée et le numéro ne sera plus attribué.',
    '',
    `Votre engagement courait jusqu'au ${frDate(COMMITMENT_END)} : des frais de résiliation`,
    `de ${eur(TERMINATION_FEE)} seront portés sur votre dernière facture, émise début`,
    'janvier 2026.',
    '',
    'Nous vous remercions de la confiance que vous nous avez accordée.',
    '',
    'Le service clients Telorca',
  ]),
  truth: truth({
    type: TYPES.terminationConfirmation,
    core: core('fr', {
      document_date: required('2025-11-27', frDate('2025-11-27')),
      issuer: required(PARTIES.telorca.key, PARTIES.telorca.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: optional(money(TERMINATION_FEE), eur(TERMINATION_FEE)),
      reference: required(CASE_NUMBER, CASE_NUMBER),
    }),
    fields: [
      { ...phoneField, expectation: optional(JANE.mobile, JANE.mobile) },
      field(
        ['contract_number', 'contract_id'],
        'identifier',
        optional(CONTRACTS.mobile, CONTRACTS.mobile),
      ),
    ],
    key_dates: [
      keyDate(['expiry', 'effective', 'event'], TERMINATION_DATE, frDate(TERMINATION_DATE)),
    ],
    links: [
      link('replies_to', terminationLetter.id),
      link('terminates', mobileContract.id, 'optional'),
    ],
    subjects: [about(SUBJECTS.mobilePlan)],
    facts: [
      fact('Telorca confirmed that the mobile contract ends on 2025-12-31.', {
        entities: [PARTIES.telorca.key],
        dates: [TERMINATION_DATE],
      }),
      fact(
        'Telorca charges a termination fee of 9.99 EUR on the last bill.',
        { entities: [PARTIES.telorca.key], amounts: [money(TERMINATION_FEE)] },
        'optional',
      ),
    ],
  }),
};

export const MOBILE_DOCUMENTS: readonly ScenarioDocument[] = [
  mobileContract,
  mobileBill({
    id: 'mobile-bill-2025-09',
    issued: '2025-09-02',
    period: ['2025-08-01', '2025-08-31'],
    due: '2025-09-12',
    extras: 0,
  }),
  mobileBill({
    id: 'mobile-bill-2025-10',
    issued: '2025-10-02',
    period: ['2025-09-01', '2025-09-30'],
    due: '2025-10-12',
    extras: 4.5,
  }),
  NOVEMBER_BILL,
  billEmail,
  terminationLetter,
  terminationConfirmation,
];
