import { seededDigits } from '../identifiers.ts';
import { CARD_TAIL, HOME_ADDRESS, IBAN_TAIL, JANE, PARTIES, SUBJECTS } from './cast.ts';
import { eur, euroNumber, frDate } from '../format.ts';
import { ADDRESSEE, letterhead, pdf } from './layout.ts';
import {
  about,
  core,
  fact,
  field,
  keyDate,
  link,
  maskedField,
  money,
  noKeyDate,
  optional,
  required,
  type ScenarioDocument,
  truth,
} from './model.ts';
import { TYPES } from './types.ts';

const BANK_CONTACT = 'Votre conseiller : 01 99 00 12 80';
const IBAN_NAMES = ['iban', 'account_iban', 'account_number', 'bank_account'];

const OPENING_BALANCE = 1846.12;
const CLOSING_BALANCE = 3214.65;
const STATEMENT_START = '2025-10-01';
const STATEMENT_END = '2025-10-31';

// One line of the statement: day, label and amount in its column.
const operation = (day: string, label: string, amount: number, credit = false): string =>
  `${day}/10  ${label.padEnd(36)}${credit ? ' '.repeat(12) : ''}${euroNumber(amount).padStart(10)}`;

const bankStatement: ScenarioDocument = {
  id: 'bank-statement-2025-10',
  description: 'Current account statement for October 2025, showing the full IBAN',
  render: pdf([
    ...letterhead('bank', BANK_CONTACT),
    'RELEVÉ DE COMPTE N° 2025-10',
    'Compte chèques de Mme Jane Doe',
    `IBAN : ${JANE.iban}`,
    `Période : du ${frDate(STATEMENT_START)} au ${frDate(STATEMENT_END)}`,
    `Date d'arrêté : ${frDate(STATEMENT_END)}`,
    '',
    `Solde au ${frDate('2025-09-30')} : ${eur(OPENING_BALANCE)}`,
    '',
    'Date   Libellé                                   Débit      Crédit',
    operation('05', 'Virement loyer Agence Vouzelin', 840),
    operation('12', 'Prélèvement Telorca', 24.49),
    operation('12', 'Paiement carte Parking Halle Yvrelle', 4.5),
    operation('16', 'Prélèvement Fibrenoix', 39.99),
    operation('18', 'Prélèvement Brisevent Électricité', 74.85),
    operation('22', 'Retrait distributeur', 60),
    operation('30', 'Virement Ostrelia Conseil salaire', 2412.36, true),
    '',
    `Total des débits : ${eur(1043.83)}`,
    `Total des crédits : ${eur(2412.36)}`,
    `Solde au ${frDate(STATEMENT_END)} : ${eur(CLOSING_BALANCE)}`,
    '',
    'Vérifiez ce relevé et signalez toute anomalie dans un délai de deux mois.',
  ]),
  truth: truth({
    type: TYPES.bankStatement,
    hard_cases: ['sensitive_identifiers'],
    core: core('fr', {
      document_date: required(STATEMENT_END, frDate(STATEMENT_END)),
      issuer: required(PARTIES.bank.key, PARTIES.bank.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: optional(money(CLOSING_BALANCE), eur(CLOSING_BALANCE)),
      period: required(
        { start: STATEMENT_START, end: STATEMENT_END },
        `du ${frDate(STATEMENT_START)} au ${frDate(STATEMENT_END)}`,
      ),
      reference: optional('2025-10', 'N° 2025-10'),
    }),
    fields: [
      maskedField(IBAN_NAMES, IBAN_TAIL, JANE.iban),
      field(
        ['closing_balance', 'ending_balance', 'new_balance'],
        'money',
        required(money(CLOSING_BALANCE), eur(CLOSING_BALANCE)),
      ),
      field(
        ['opening_balance', 'previous_balance', 'starting_balance'],
        'money',
        optional(money(OPENING_BALANCE), eur(OPENING_BALANCE)),
      ),
    ],
    key_dates: [noKeyDate('due', 'expiry', 'renewal')],
    // The statement debits these three bills to the cent on the day each one announces.
    links: ['mobile-bill-2025-10', 'internet-bill-2025-10', 'energy-bill-2025-10'].map((bill) =>
      link('pays', bill, 'optional'),
    ),
    subjects: [about(SUBJECTS.bankAccount)],
    facts: [
      fact('The current account at Crédit Yvrellois held 3214.65 EUR on 2025-10-31.', {
        entities: [PARTIES.bank.key],
        amounts: [money(CLOSING_BALANCE)],
        dates: [STATEMENT_END],
      }),
    ],
    masking: [{ kind: 'iban', clear: JANE.iban, visible_tail: IBAN_TAIL }],
    private: 'optional',
  }),
};

const BLOCKED_ON = '2025-09-09';
const NOTICE_DATE = '2025-09-10';
const BLOCK_REFERENCE = `OPP-2025-${seededDigits('card-block', 5)}`;

const cardNotice: ScenarioDocument = {
  id: 'bank-card-notice-2025-09',
  description:
    'Bank letter confirming that a lost card was blocked, with the card number and the IBAN in clear',
  render: pdf([
    ...letterhead('bank', BANK_CONTACT),
    ...ADDRESSEE,
    `Trévolzac-sur-Yvrelle, le ${frDate(NOTICE_DATE)}`,
    '',
    'Objet : confirmation de mise en opposition de votre carte bancaire',
    `Référence : ${BLOCK_REFERENCE}`,
    '',
    'Madame,',
    '',
    `Vous nous avez signalé le ${frDate(BLOCKED_ON)} la perte de votre carte bancaire.`,
    'Nous vous confirmons sa mise en opposition.',
    '',
    `Carte n° ${JANE.card}`,
    `Compte associé : IBAN ${JANE.iban}`,
    `Date et heure de l'opposition : ${frDate(BLOCKED_ON)} à 18 h 05`,
    '',
    "Aucune opération n'a été enregistrée après cette date. Une nouvelle",
    'carte vous sera envoyée sous dix jours ouvrés ; son code confidentiel',
    'reste inchangé. Cette opposition est gratuite.',
    '',
    'Votre conseiller Crédit Yvrellois',
  ]),
  truth: truth({
    type: TYPES.bankNotice,
    hard_cases: ['sensitive_identifiers'],
    core: core('fr', {
      document_date: required(NOTICE_DATE, frDate(NOTICE_DATE)),
      issuer: required(PARTIES.bank.key, PARTIES.bank.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      reference: required(BLOCK_REFERENCE, BLOCK_REFERENCE),
    }),
    fields: [
      maskedField(['card_number', 'bank_card_number', 'payment_card_number'], CARD_TAIL, JANE.card),
      maskedField(IBAN_NAMES, IBAN_TAIL, JANE.iban, 'optional'),
    ],
    key_dates: [
      keyDate(['event', 'effective'], BLOCKED_ON, frDate(BLOCKED_ON), 'optional'),
      noKeyDate('due'),
    ],
    subjects: [about(SUBJECTS.bankAccount)],
    facts: [
      fact('Crédit Yvrellois blocked the lost bank card on 2025-09-09 and sends a new one.', {
        entities: [PARTIES.bank.key],
        dates: [BLOCKED_ON],
      }),
    ],
    masking: [
      { kind: 'card_number', clear: JANE.card, visible_tail: CARD_TAIL },
      { kind: 'iban', clear: JANE.iban, visible_tail: IBAN_TAIL },
    ],
    private: 'optional',
  }),
};

const TAX_NOTICE_DATE = '2025-08-04';
const TAX_DUE = '2025-09-15';
const TAX_BALANCE = 1284;
const TAX_TOTAL = 1902;
const TAX_NOTICE_NUMBER = `25 99 ${seededDigits('tax-notice', 7)} ${seededDigits('tax-notice-key', 2)}`;
const TAX_NUMBER_TAIL = JANE.taxNumber.replace(/\s/g, '').slice(-4);

const taxNotice: ScenarioDocument = {
  id: 'tax-notice-2025',
  description: 'Income tax notice for the income of 2024, with the tax number in clear',
  render: pdf([
    ...letterhead('taxOffice'),
    "AVIS D'IMPÔT 2025 - IMPÔT SUR LES REVENUS DE 2024",
    `Date d'établissement : ${frDate(TAX_NOTICE_DATE)}`,
    `Numéro fiscal : ${JANE.taxNumber}`,
    `Référence de l'avis : ${TAX_NOTICE_NUMBER}`,
    '',
    'Déclarant : Mme Jane Doe',
    HOME_ADDRESS,
    '',
    'Revenu brut global : 34 940 €',
    'Revenu imposable : 31 450 €',
    'Revenu fiscal de référence : 31 450 €',
    'Nombre de parts : 1',
    '',
    `Impôt sur le revenu net : ${eur(TAX_TOTAL)}`,
    `Prélèvements à la source déjà versés en 2024 : ${eur(618)}`,
    `Reste à payer : ${eur(TAX_BALANCE)}`,
    `Date limite de paiement : ${frDate(TAX_DUE)}`,
    `La somme sera prélevée sur le compte se terminant par ${IBAN_TAIL}.`,
    '',
    'Conservez cet avis : il vous sera demandé pour justifier de vos',
    'ressources.',
  ]),
  truth: truth({
    type: TYPES.taxNotice,
    hard_cases: ['private', 'sensitive_identifiers'],
    core: core('fr', {
      document_date: required(TAX_NOTICE_DATE, frDate(TAX_NOTICE_DATE)),
      issuer: required(PARTIES.taxOffice.key, PARTIES.taxOffice.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(TAX_BALANCE), `Reste à payer : ${eur(TAX_BALANCE)}`, [
        money(TAX_TOTAL),
      ]),
      period: optional({ start: '2024-01-01', end: '2024-12-31' }, null),
      due_date: required(TAX_DUE, frDate(TAX_DUE)),
      reference: required(TAX_NOTICE_NUMBER, TAX_NOTICE_NUMBER),
    }),
    fields: [
      field(
        ['reference_tax_income', 'reference_income', 'taxable_income'],
        'money',
        required(money(31450), '31 450 €'),
      ),
      field(
        ['income_tax', 'net_income_tax', 'tax_amount'],
        'money',
        optional(money(TAX_TOTAL), eur(TAX_TOTAL)),
      ),
      field(['tax_year', 'income_year'], 'number', optional(2024, 'REVENUS DE 2024')),
      maskedField(
        ['tax_number', 'tax_identification_number', 'tax_id'],
        TAX_NUMBER_TAIL,
        JANE.taxNumber,
        'optional',
      ),
    ],
    key_dates: [keyDate('due', TAX_DUE, frDate(TAX_DUE))],
    facts: [
      fact('The income tax on the income of 2024 leaves 1284 EUR to pay by 2025-09-15.', {
        entities: [PARTIES.taxOffice.key],
        amounts: [money(TAX_BALANCE)],
        dates: [TAX_DUE],
      }),
    ],
    masking: [{ kind: 'tax_number', clear: JANE.taxNumber, visible_tail: TAX_NUMBER_TAIL }],
    private: 'required',
  }),
};

export const MONEY_DOCUMENTS: readonly ScenarioDocument[] = [bankStatement, cardNotice, taxNotice];
