import { seededDigits } from '../identifiers.ts';
import { CONTRACTS, HOME_ADDRESS, IBAN_TAIL, METER_ID, PARTIES, SUBJECTS } from './cast.ts';
import { cents, eur, frDate, fromCents } from '../format.ts';
import { letterhead, pdf, scannedPdf } from './layout.ts';
import {
  about,
  core,
  fact,
  field,
  keyDate,
  money,
  noKeyDate,
  optional,
  required,
  type ScenarioDocument,
  truth,
} from './model.ts';
import { TYPES } from './types.ts';

const SUPPLIERS = {
  voltaneige: {
    party: PARTIES.voltaneige,
    subject: SUBJECTS.energyVoltaneige,
    contract: CONTRACTS.voltaneige,
    customer: `C${seededDigits('voltaneige-customer', 8)}`,
    offer: 'Offre Tarif Neige',
    contact: 'Service clients : 01 99 00 41 20',
    monthlySubscriptionCents: 1260,
    footer: 'Voltaneige Energie SAS - contact@voltaneige.example - www.voltaneige.example',
  },
  brisevent: {
    party: PARTIES.brisevent,
    subject: SUBJECTS.energyBrisevent,
    contract: CONTRACTS.brisevent,
    customer: `BR${seededDigits('brisevent-customer', 7)}`,
    offer: 'Offre Brise Fixe',
    contact: 'Service clients : 01 99 00 52 77',
    monthlySubscriptionCents: 1190,
    footer: 'Brisevent Électricité SA - clients@brisevent.example - www.brisevent.example',
  },
} as const;

type SupplierName = keyof typeof SUPPLIERS;

interface EnergyBill {
  readonly id: string;
  readonly supplier: SupplierName;
  readonly issued: string;
  readonly period: readonly [start: string, end: string];
  readonly months: number;
  readonly due: string;
  readonly amount: number;
  readonly kwh: number;
  // The last bill of a contract, which also says when the contract ended.
  readonly closedOn?: string;
  readonly scanned?: boolean;
}

const TAX_SHARE = 0.21;

const billLines = (bill: EnergyBill, number: string): readonly string[] => {
  const supplier = SUPPLIERS[bill.supplier];
  const [start, end] = bill.period;
  const subscription = bill.months * supplier.monthlySubscriptionCents;
  const taxes = Math.round(cents(bill.amount) * TAX_SHARE);
  const consumption = cents(bill.amount) - subscription - taxes;
  return [
    ...letterhead(bill.supplier, supplier.contact),
    `${bill.closedOn === undefined ? "FACTURE D'ÉLECTRICITÉ" : 'FACTURE DE CLÔTURE'} N° ${number}`,
    `Date de facture : ${frDate(bill.issued)}`,
    '',
    'Titulaire du contrat : Mme Jane Doe',
    `Lieu de consommation : ${HOME_ADDRESS}`,
    `Référence client : ${supplier.customer}`,
    `Contrat n° ${supplier.contract} - ${supplier.offer}`,
    `Point de livraison (PDL) : ${METER_ID}`,
    '',
    `Période facturée : du ${frDate(start)} au ${frDate(end)}`,
    `Consommation relevée : ${String(bill.kwh)} kWh`,
    '',
    'Détail de la facture',
    `Abonnement (${String(bill.months)} mois) : ${eur(fromCents(subscription))}`,
    `Consommation : ${eur(fromCents(consumption))}`,
    `Taxes et contributions, TVA incluse : ${eur(fromCents(taxes))}`,
    '',
    `Montant total TTC : ${eur(bill.amount)}`,
    `À payer avant le ${frDate(bill.due)}`,
    `Le montant sera prélevé sur le compte se terminant par ${IBAN_TAIL}.`,
    ...(bill.closedOn === undefined
      ? []
      : [
          '',
          `Votre contrat a pris fin le ${frDate(bill.closedOn)}, à la suite de votre`,
          'changement de fournisseur. Cette facture solde votre compte client.',
        ]),
    '',
    supplier.footer,
  ];
};

const energyBill = (bill: EnergyBill): ScenarioDocument => {
  const supplier = SUPPLIERS[bill.supplier];
  const [start, end] = bill.period;
  const number = `${bill.supplier === 'voltaneige' ? 'VE' : 'BV'}-F-${bill.issued.slice(0, 7)}-${seededDigits(bill.id, 5)}`;
  const lines = billLines(bill, number);
  const name = supplier.party.canonical_name;
  return {
    id: bill.id,
    description: `Electricity bill from ${name} for ${start} to ${end}${bill.closedOn === undefined ? '' : ', the last one of the contract'}${bill.scanned === true ? ', scanned' : ''}`,
    render: bill.scanned === true ? scannedPdf('scan', lines) : pdf(lines),
    truth: truth({
      type: TYPES.energyBill,
      core: core('fr', {
        document_date: required(bill.issued, frDate(bill.issued)),
        issuer: required(supplier.party.key, supplier.party.printed),
        recipient: required(PARTIES.jane.key, 'Jane Doe'),
        amount: required(money(bill.amount), eur(bill.amount)),
        period: required({ start, end }, `du ${frDate(start)} au ${frDate(end)}`),
        due_date: required(bill.due, frDate(bill.due)),
        reference: required(number, number),
      }),
      fields: [
        field(['meter_id', 'delivery_point_id', 'pdl'], 'identifier', required(METER_ID, METER_ID)),
        field(
          ['consumption_kwh', 'consumption', 'energy_consumption_kwh'],
          'number',
          required(bill.kwh, `${String(bill.kwh)} kWh`),
        ),
        field(
          ['customer_number', 'customer_reference', 'customer_id'],
          'identifier',
          optional(supplier.customer, supplier.customer),
        ),
        field(
          ['contract_number', 'contract_id'],
          'identifier',
          optional(supplier.contract, supplier.contract),
        ),
      ],
      key_dates: [
        keyDate('due', bill.due, frDate(bill.due)),
        ...(bill.closedOn === undefined
          ? [noKeyDate('renewal')]
          : [keyDate(['expiry', 'event'], bill.closedOn, frDate(bill.closedOn), 'optional')]),
      ],
      subjects: [about(SUBJECTS.home), about(supplier.subject, 'optional')],
      facts: [
        fact(
          `${name} billed ${String(bill.amount)} EUR for the electricity of ${start} to ${end}.`,
          {
            entities: [supplier.party.key],
            amounts: [money(bill.amount)],
          },
        ),
        ...(bill.closedOn === undefined
          ? []
          : [
              fact(`The electricity contract with ${name} ended on ${bill.closedOn}.`, {
                entities: [supplier.party.key],
                dates: [bill.closedOn],
              }),
            ]),
      ],
    }),
  };
};

const SWITCH_DATE = '2025-04-01';
const SIGNED_ON = '2025-03-12';
const LAST_DAY_WITH_VOLTANEIGE = '2025-03-31';

const supplyContract: ScenarioDocument = {
  id: 'energy-contract-brisevent',
  description:
    'Electricity supply contract with Brisevent, which takes over from Voltaneige on 2025-04-01',
  render: pdf([
    ...letterhead('brisevent', SUPPLIERS.brisevent.contact),
    "CONTRAT DE FOURNITURE D'ÉLECTRICITÉ - CONDITIONS PARTICULIÈRES",
    `Contrat n° ${CONTRACTS.brisevent}`,
    `Fait à Port-Lanvec, le ${frDate(SIGNED_ON)}`,
    '',
    'Client : Mme Jane Doe',
    `Lieu de consommation : ${HOME_ADDRESS}`,
    `Point de livraison (PDL) : ${METER_ID}`,
    'Offre souscrite : Brise Fixe - puissance 6 kVA - option base',
    '',
    `Date de début de fourniture : ${frDate(SWITCH_DATE)}`,
    'Durée : contrat à durée indéterminée, sans engagement. Vous pouvez le',
    'résilier à tout moment, sans frais et sans préavis.',
    '',
    'Changement de fournisseur : Brisevent se charge de résilier votre contrat',
    'auprès de votre fournisseur actuel, Voltaneige Energie. La fourniture par',
    `Brisevent débute le ${frDate(SWITCH_DATE)} ; votre ancien contrat prend fin la`,
    `veille, le ${frDate(LAST_DAY_WITH_VOLTANEIGE)}, sans coupure.`,
    '',
    `Prix : abonnement ${eur(11.9)} TTC par mois ; prix du kWh 0,1920 € TTC.`,
    'Facturation tous les deux mois, paiement par prélèvement automatique.',
    `Mandat de prélèvement signé le ${frDate(SIGNED_ON)}, compte se terminant par ${IBAN_TAIL}.`,
    '',
    SUPPLIERS.brisevent.footer,
  ]),
  truth: truth({
    type: TYPES.energyContract,
    core: core('fr', {
      document_date: required(SIGNED_ON, frDate(SIGNED_ON)),
      issuer: required(PARTIES.brisevent.key, PARTIES.brisevent.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      // The only amount is a monthly price: finding it is fine, any other figure is not.
      amount: optional(money(11.9), eur(11.9)),
      reference: required(CONTRACTS.brisevent, CONTRACTS.brisevent),
    }),
    fields: [
      field(['meter_id', 'delivery_point_id', 'pdl'], 'identifier', required(METER_ID, METER_ID)),
      field(
        ['previous_supplier', 'former_supplier', 'current_supplier'],
        'entity',
        optional('Voltaneige Energie', 'Voltaneige Energie'),
      ),
    ],
    key_dates: [
      keyDate('effective', SWITCH_DATE, frDate(SWITCH_DATE)),
      // The contract has no term of its own, but it prints the last day of the one it
      // replaces.
      keyDate(
        ['expiry', 'event'],
        LAST_DAY_WITH_VOLTANEIGE,
        frDate(LAST_DAY_WITH_VOLTANEIGE),
        'optional',
      ),
      noKeyDate('renewal', 'notice_deadline'),
    ],
    subjects: [
      about(SUBJECTS.home),
      about(SUBJECTS.energyBrisevent),
      about(SUBJECTS.energyVoltaneige, 'optional'),
    ],
    facts: [
      fact(
        'Brisevent supplies the electricity of the home from 2025-04-01, replacing Voltaneige.',
        {
          entities: [PARTIES.brisevent.key, PARTIES.voltaneige.key],
          dates: [SWITCH_DATE],
        },
      ),
      fact(
        'The Brisevent contract has no fixed term and can be ended at any time without notice.',
        { entities: [PARTIES.brisevent.key] },
        'optional',
      ),
    ],
  }),
};

const BILL_2025_06 = energyBill({
  id: 'energy-bill-2025-06',
  supplier: 'brisevent',
  issued: '2025-06-03',
  period: ['2025-04-01', '2025-05-31'],
  months: 2,
  due: '2025-06-18',
  amount: 88.9,
  kwh: 402,
});

// The same file saved twice under two names: ingestion must keep one document.
const duplicateBill: ScenarioDocument = {
  id: 'energy-bill-2025-06-copy',
  description: 'The Brisevent bill of June 2025 again, byte for byte, under another file name',
  render: { kind: 'copy', of: BILL_2025_06.id },
  truth: { ...BILL_2025_06.truth, duplicate_of: BILL_2025_06.id, hard_cases: ['duplicate_file'] },
};

export const ENERGY_DOCUMENTS: readonly ScenarioDocument[] = [
  energyBill({
    id: 'energy-bill-2024-11',
    supplier: 'voltaneige',
    issued: '2024-11-05',
    period: ['2024-09-01', '2024-10-31'],
    months: 2,
    due: '2024-11-20',
    amount: 96.4,
    kwh: 412,
  }),
  energyBill({
    id: 'energy-bill-2025-01',
    supplier: 'voltaneige',
    issued: '2025-01-06',
    period: ['2024-11-01', '2024-12-31'],
    months: 2,
    due: '2025-01-21',
    amount: 142.75,
    kwh: 655,
  }),
  energyBill({
    id: 'energy-bill-2025-03',
    supplier: 'voltaneige',
    issued: '2025-03-05',
    period: ['2025-01-01', '2025-02-28'],
    months: 2,
    due: '2025-03-20',
    amount: 158.3,
    kwh: 731,
  }),
  supplyContract,
  energyBill({
    id: 'energy-closing-bill-2025-04',
    supplier: 'voltaneige',
    issued: '2025-04-08',
    period: ['2025-03-01', LAST_DAY_WITH_VOLTANEIGE],
    months: 1,
    due: '2025-04-23',
    amount: 61.15,
    kwh: 268,
    closedOn: LAST_DAY_WITH_VOLTANEIGE,
    scanned: true,
  }),
  BILL_2025_06,
  duplicateBill,
  energyBill({
    id: 'energy-bill-2025-08',
    supplier: 'brisevent',
    issued: '2025-08-04',
    period: ['2025-06-01', '2025-07-31'],
    months: 2,
    due: '2025-08-19',
    amount: 71.2,
    kwh: 318,
  }),
  energyBill({
    id: 'energy-bill-2025-10',
    supplier: 'brisevent',
    issued: '2025-10-03',
    period: ['2025-08-01', '2025-09-30'],
    months: 2,
    due: '2025-10-18',
    amount: 74.85,
    kwh: 336,
  }),
];
