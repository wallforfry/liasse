import { seededDigits } from '../identifiers.ts';
import { CARD_TAIL, HOME_ADDRESS, PARTIES, SUBJECTS } from './cast.ts';
import { cents, eur, frDate, fromCents } from '../format.ts';
import { letterhead, pdf, scannedPdf } from './layout.ts';
import {
  about,
  core,
  fact,
  field,
  keyDate,
  link,
  money,
  noKeyDate,
  optional,
  required,
  type ScenarioDocument,
  truth,
} from './model.ts';
import { TYPES } from './types.ts';
const WATER_CUSTOMER = `A${seededDigits('water-customer', 7)}`;
const WATER_METER = `W${seededDigits('water-meter', 8)}`;
const WATER_SUBSCRIPTION_CENTS = 3240;

interface WaterBill {
  readonly id: string;
  readonly issued: string;
  readonly period: readonly [start: string, end: string];
  readonly due: string;
  readonly amount: number;
  readonly index: readonly [previous: number, current: number];
  readonly scanned?: boolean;
}

const waterBillNumber = (bill: WaterBill): string =>
  `REO-${bill.issued.slice(0, 7)}-${seededDigits(bill.id, 5)}`;

const waterBill = (bill: WaterBill): ScenarioDocument => {
  const [start, end] = bill.period;
  const [previous, current] = bill.index;
  const number = waterBillNumber(bill);
  const volume = current - previous;
  const taxes = Math.round(cents(bill.amount) * 0.15);
  const sanitation = Math.round((cents(bill.amount) - WATER_SUBSCRIPTION_CENTS - taxes) * 0.45);
  const drinkingWater = cents(bill.amount) - WATER_SUBSCRIPTION_CENTS - taxes - sanitation;
  const lines = [
    ...letterhead('waterBoard', 'Accueil : 01 99 00 30 08'),
    `FACTURE D'EAU N° ${number}`,
    `Date de facture : ${frDate(bill.issued)}`,
    '',
    'Abonné : Mme Jane Doe',
    `Adresse desservie : ${HOME_ADDRESS}`,
    `Référence abonné : ${WATER_CUSTOMER}`,
    `Compteur n° ${WATER_METER}`,
    '',
    `Période de consommation : du ${frDate(start)} au ${frDate(end)}`,
    `Ancien index : ${String(previous)} m3 - Nouvel index : ${String(current)} m3`,
    `Consommation : ${String(volume)} m3`,
    '',
    `Abonnement semestriel : ${eur(fromCents(WATER_SUBSCRIPTION_CENTS))}`,
    `Eau potable : ${eur(fromCents(drinkingWater))}`,
    `Assainissement : ${eur(fromCents(sanitation))}`,
    `Redevances et TVA : ${eur(fromCents(taxes))}`,
    '',
    `Montant total TTC : ${eur(bill.amount)}`,
    `À régler avant le ${frDate(bill.due)}, par virement, par chèque ou par carte`,
    'bancaire sur le site de la régie.',
    `Référence à rappeler lors du paiement : ${number}`,
  ];
  return {
    id: bill.id,
    description: `Water bill from the local water board for ${start} to ${end}${bill.scanned === true ? ', scanned' : ''}`,
    render: bill.scanned === true ? scannedPdf('scan', lines) : pdf(lines),
    truth: truth({
      type: TYPES.waterBill,
      core: core('fr', {
        document_date: required(bill.issued, frDate(bill.issued)),
        issuer: required(PARTIES.waterBoard.key, PARTIES.waterBoard.printed),
        recipient: required(PARTIES.jane.key, 'Jane Doe'),
        amount: required(money(bill.amount), eur(bill.amount)),
        period: required({ start, end }, `du ${frDate(start)} au ${frDate(end)}`),
        due_date: required(bill.due, frDate(bill.due)),
        reference: required(number, number),
      }),
      fields: [
        field(
          ['consumption_m3', 'consumption', 'water_consumption_m3', 'volume_m3'],
          'number',
          required(volume, `${String(volume)} m3`),
        ),
        field(['meter_id', 'meter_number'], 'identifier', optional(WATER_METER, WATER_METER)),
        field(
          ['customer_number', 'subscriber_number', 'customer_reference'],
          'identifier',
          optional(WATER_CUSTOMER, WATER_CUSTOMER),
        ),
      ],
      key_dates: [keyDate('due', bill.due, frDate(bill.due))],
      subjects: [about(SUBJECTS.home)],
      facts: [
        fact(
          `The water board billed ${String(bill.amount)} EUR for the water of ${start} to ${end}.`,
          {
            entities: [PARTIES.waterBoard.key],
            amounts: [money(bill.amount)],
          },
        ),
      ],
    }),
  };
};

const SUMMER_WATER_BILL: WaterBill = {
  id: 'water-bill-2025-07',
  issued: '2025-07-16',
  period: ['2025-01-01', '2025-06-30'],
  due: '2025-08-06',
  amount: 203.45,
  index: [556, 608],
};

const PAYMENT_DATE = '2025-07-28';
const PAYMENT_NUMBER = `P-2025-${seededDigits('water-payment', 6)}`;

const waterPayment: ScenarioDocument = {
  id: 'water-payment-2025-07',
  description: 'Receipt from the water board for the online payment of the July 2025 bill',
  render: pdf([
    ...letterhead('waterBoard', 'Accueil : 01 99 00 30 08'),
    `REÇU DE PAIEMENT N° ${PAYMENT_NUMBER}`,
    `Valmont-sur-Orbe, le ${frDate(PAYMENT_DATE)}`,
    '',
    'Abonné : Mme Jane Doe',
    `Référence abonné : ${WATER_CUSTOMER}`,
    '',
    'Nous confirmons avoir reçu votre paiement.',
    `Montant payé : ${eur(SUMMER_WATER_BILL.amount)}`,
    `Date du paiement : ${frDate(PAYMENT_DATE)}`,
    `Moyen de paiement : carte bancaire en ligne, carte se terminant par ${CARD_TAIL}`,
    `Facture réglée : n° ${waterBillNumber(SUMMER_WATER_BILL)} du ${frDate(SUMMER_WATER_BILL.issued)}`,
    `Solde restant dû : ${eur(0)}`,
    '',
    'Ce reçu ne vaut pas facture. Conservez-le avec la facture correspondante.',
  ]),
  truth: truth({
    type: TYPES.paymentConfirmation,
    core: core('fr', {
      document_date: required(PAYMENT_DATE, frDate(PAYMENT_DATE)),
      issuer: required(PARTIES.waterBoard.key, PARTIES.waterBoard.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(
        money(SUMMER_WATER_BILL.amount),
        `Montant payé : ${eur(SUMMER_WATER_BILL.amount)}`,
      ),
      reference: required(PAYMENT_NUMBER, PAYMENT_NUMBER, [waterBillNumber(SUMMER_WATER_BILL)]),
    }),
    key_dates: [noKeyDate('due')],
    links: [link('pays', SUMMER_WATER_BILL.id)],
    subjects: [about(SUBJECTS.home, 'optional')],
    facts: [
      fact('Jane Doe paid the water bill of 203.45 EUR on 2025-07-28.', {
        entities: [PARTIES.waterBoard.key],
        amounts: [money(SUMMER_WATER_BILL.amount)],
        dates: [PAYMENT_DATE],
      }),
    ],
  }),
};

export const WATER_DOCUMENTS: readonly ScenarioDocument[] = [
  waterBill({
    id: 'water-bill-2025-01',
    issued: '2025-01-15',
    period: ['2024-07-01', '2024-12-31'],
    due: '2025-02-05',
    amount: 187.6,
    index: [508, 556],
    scanned: true,
  }),
  waterBill(SUMMER_WATER_BILL),
  waterPayment,
];
