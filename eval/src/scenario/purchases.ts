import { CARD_TAIL, HOME_ADDRESS, JANE, PARTIES } from './cast.ts';
import { enDate, englishNumber, eur, euroNumber, frDate, shortDate, usDate } from '../format.ts';
import { pdf, scannedPdf } from './layout.ts';
import {
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

const BIKE_DATE = '2024-08-17';
const BIKE_TOTAL = 1249;
const BIKE_WARRANTY_END = '2026-08-17';

const bikeInvoice: ScenarioDocument = {
  id: 'bike-invoice-2024-08',
  description:
    'Invoice in English and in pounds for an electric bicycle bought from a British shop',
  render: pdf([
    PARTIES.bikeShop.printed,
    PARTIES.bikeShop.address,
    'sales@brindlemoor-cycles.example - Tel. 020 7946 0312',
    '',
    'INVOICE No. BC-24-08117',
    `Invoice date: ${enDate(BIKE_DATE)}`,
    'Order: WEB-58231',
    '',
    'Bill to: Ms Jane Doe',
    `${HOME_ADDRESS}, France`,
    '',
    `1 x Fernway E-Tourer electric bicycle, frame size M: GBP ${englishNumber(1180)}`,
    'Frame number: FW24M0093311',
    `1 x Delivery to France: GBP ${englishNumber(69)}`,
    '',
    `Total (export sale, no UK VAT): GBP ${englishNumber(BIKE_TOTAL)}`,
    '',
    `Paid in full by card on ${enDate(BIKE_DATE)}. Thank you for your order.`,
    `Warranty: 2 years on frame and motor, until ${enDate(BIKE_WARRANTY_END)}.`,
  ]),
  truth: truth({
    type: TYPES.purchaseInvoice,
    hard_cases: ['foreign_currency'],
    core: core('en', {
      document_date: required(BIKE_DATE, enDate(BIKE_DATE)),
      issuer: required(PARTIES.bikeShop.key, PARTIES.bikeShop.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(BIKE_TOTAL, 'GBP'), `GBP ${englishNumber(BIKE_TOTAL)}`),
      reference: required('BC-24-08117', 'BC-24-08117', ['WEB-58231']),
    }),
    fields: [
      field(
        ['frame_number', 'serial_number'],
        'identifier',
        optional('FW24M0093311', 'FW24M0093311'),
      ),
      field(['order_number', 'order_reference'], 'identifier', optional('WEB-58231', 'WEB-58231')),
    ],
    key_dates: [
      keyDate('expiry', BIKE_WARRANTY_END, enDate(BIKE_WARRANTY_END), 'optional'),
      noKeyDate('due'),
    ],
    facts: [
      fact(
        'Jane Doe bought an electric bicycle from Brindlemoor Cycles for 1249 GBP on 2024-08-17.',
        {
          entities: [PARTIES.bikeShop.key],
          amounts: [money(BIKE_TOTAL, 'GBP')],
        },
      ),
    ],
  }),
};

const CLOUD_DATE = '2025-05-01';
const CLOUD_END = '2026-04-30';
const CLOUD_RENEWAL = '2026-05-01';
const CLOUD_PERIOD = `${usDate(CLOUD_DATE)} to ${usDate(CLOUD_END)}`;

const cloudInvoice: ScenarioDocument = {
  id: 'cloud-invoice-2025-05',
  description: 'Invoice in English and in US dollars for a yearly cloud storage subscription',
  render: pdf([
    PARTIES.cloud.printed,
    PARTIES.cloud.address,
    'billing@quillfern.example',
    '',
    'INVOICE QF-2025-004417',
    `Date issued: ${usDate(CLOUD_DATE)}`,
    `Billed to: Jane Doe (${JANE.email})`,
    '',
    'Quillfern Personal plan, 200 GB storage - annual subscription',
    `Service period: ${CLOUD_PERIOD}`,
    '',
    'Subtotal: $96.00',
    'Tax: $0.00',
    'Total: $96.00 USD',
    '',
    `Paid on ${usDate(CLOUD_DATE)} with the card ending in ${CARD_TAIL}.`,
    `Your subscription renews automatically on ${usDate(CLOUD_RENEWAL)} unless you`,
    'cancel it before that date in your account settings.',
  ]),
  truth: truth({
    type: TYPES.subscriptionInvoice,
    hard_cases: ['foreign_currency'],
    core: core('en', {
      document_date: required(CLOUD_DATE, usDate(CLOUD_DATE)),
      issuer: required(PARTIES.cloud.key, PARTIES.cloud.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(96, 'USD'), '$96.00 USD'),
      period: required({ start: CLOUD_DATE, end: CLOUD_END }, CLOUD_PERIOD),
      reference: required('QF-2025-004417', 'QF-2025-004417'),
    }),
    key_dates: [keyDate('renewal', CLOUD_RENEWAL, usDate(CLOUD_RENEWAL)), noKeyDate('due')],
    facts: [
      fact(
        'The Quillfern cloud storage subscription costs 96 USD a year and renews on 2026-05-01.',
        {
          entities: [PARTIES.cloud.key],
          amounts: [money(96, 'USD')],
          dates: [CLOUD_RENEWAL],
        },
      ),
    ],
  }),
};

const FURNITURE_DATE = '1998-11-14';

const furnitureInvoice: ScenarioDocument = {
  id: 'furniture-invoice-1998',
  description: 'Old furniture invoice in French francs, a worn sheet scanned askew',
  render: scannedPdf('archive', [
    PARTIES.furniture.printed,
    PARTIES.furniture.address,
    'Maison fondée en 1954',
    '',
    'FACTURE N° 98-1147',
    `Le ${frDate(FURNITURE_DATE)}`,
    '',
    'Vendu à : Mme Jane Doe, 9 rue du Lavoir, Valmont-sur-Orbe',
    '',
    '1 armoire en chêne massif, 2 portes, réf. A212 : 4 350,00 F',
    'Livraison et installation : 500,00 F',
    '',
    'Total TTC : 4 850,00 F',
    'dont TVA 20,6 % : 828,46 F',
    'Soit, à titre indicatif : 739,38 euros',
    '',
    'Payé par chèque. Marchandise garantie deux ans.',
  ]),
  truth: truth({
    type: TYPES.purchaseInvoice,
    hard_cases: ['withdrawn_currency'],
    core: core('fr', {
      document_date: required(FURNITURE_DATE, frDate(FURNITURE_DATE)),
      issuer: required(PARTIES.furniture.key, PARTIES.furniture.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(4850, 'FRF'), 'Total TTC : 4 850,00 F', [money(739.38)]),
      reference: required('98-1147', '98-1147'),
    }),
    key_dates: [noKeyDate('due')],
    facts: [
      fact(
        'Meubles Sauvageon sold Jane Doe an oak wardrobe for 4850 French francs on 1998-11-14.',
        {
          entities: [PARTIES.furniture.key],
          amounts: [money(4850, 'FRF')],
        },
      ),
    ],
  }),
};

const RECEIPT_DATE = '2025-04-19';

const item = (label: string, price: number): string =>
  `${label.padEnd(26)}${euroNumber(price).padStart(8)}`;

const hardwareReceipt: ScenarioDocument = {
  id: 'hardware-receipt-2025-04',
  description: 'Phone photo of a hardware store till receipt, saved as HEIC',
  render: {
    kind: 'image',
    encoding: 'heic',
    paper: 'receipt',
    lines: [
      PARTIES.hardware.printed,
      'ZA des Gravières',
      'Valmont-sur-Orbe',
      'Tél. 01 99 00 71 18',
      '',
      'Ticket 0417-0032-118',
      `${shortDate(RECEIPT_DATE)} 11:26`,
      '',
      item('Peinture blanche 2,5 L', 24.9),
      item('Rouleau et bac', 9.8),
      item('Ruban de masquage x2', 6.6),
      item('Enduit de rebouchage', 16),
      '-'.repeat(34),
      `TOTAL ${eur(57.3).padStart(28)}`,
      item('dont TVA 20 %', 9.55),
      item(`CB ************${CARD_TAIL}`, 57.3),
      '',
      'Échange sous 30 jours avec ticket',
      'Merci de votre visite',
    ],
  },
  truth: truth({
    type: TYPES.storeReceipt,
    core: core('fr', {
      document_date: required(RECEIPT_DATE, shortDate(RECEIPT_DATE)),
      issuer: required(PARTIES.hardware.key, PARTIES.hardware.printed),
      amount: required(money(57.3), eur(57.3)),
      reference: optional('0417-0032-118', '0417-0032-118'),
    }),
    key_dates: [noKeyDate('due')],
    facts: [
      fact('Paint and decorating supplies were bought at Bricorbe for 57.30 EUR on 2025-04-19.', {
        entities: [PARTIES.hardware.key],
        amounts: [money(57.3)],
      }),
    ],
  }),
};

export const PURCHASE_DOCUMENTS: readonly ScenarioDocument[] = [
  furnitureInvoice,
  bikeInvoice,
  hardwareReceipt,
  cloudInvoice,
];
