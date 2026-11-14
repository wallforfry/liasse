import { seededDigits } from '../identifiers.ts';
import { CAR, HOME_ADDRESS, PARTIES, SUBJECTS } from './cast.ts';
import { eur, frDate } from '../format.ts';
import { letterhead, pdf, scannedPdf, SENDER, wrap } from './layout.ts';
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
  type TruthSpec,
} from './model.ts';
import { TYPES } from './types.ts';

const PLATE_NAMES = [
  'license_plate',
  'registration_number',
  'plate_number',
  'vehicle_registration',
];
const MILEAGE_NAMES = ['mileage_km', 'mileage', 'odometer_km'];
const plateField = field(PLATE_NAMES, 'identifier', required(CAR.plate, CAR.plate));

const GARAGE_DATE = '2025-02-12';
const GARAGE_INVOICE = 'GB-2025-0212';
const GARAGE_TOTAL = 398.4;

const garageLines: readonly string[] = [
  ...letterhead('garage', 'Tél. 01 99 00 36 14'),
  `FACTURE N° ${GARAGE_INVOICE}`,
  `Date : ${frDate(GARAGE_DATE)}`,
  '',
  'Client : Mme Jane Doe',
  `Véhicule : ${CAR.model} - immatriculation ${CAR.plate}`,
  'Kilométrage : 84 210 km',
  '',
  `Révision annuelle (vidange, filtres) : ${eur(148)}`,
  `2 pneus avant 195/65 R15 : ${eur(156)}`,
  `Montage et équilibrage : ${eur(28)}`,
  '',
  `Total HT : ${eur(332)}`,
  `TVA 20 % : ${eur(66.4)}`,
  `Total TTC : ${eur(GARAGE_TOTAL)}`,
  '',
  `Payé par carte bancaire le ${frDate(GARAGE_DATE)}.`,
  "Garantie pièces et main-d'oeuvre : 12 mois.",
];

const garageTruth: TruthSpec = truth({
  type: TYPES.repairInvoice,
  core: core('fr', {
    document_date: required(GARAGE_DATE, frDate(GARAGE_DATE)),
    issuer: required(PARTIES.garage.key, PARTIES.garage.printed),
    recipient: required(PARTIES.jane.key, 'Jane Doe'),
    amount: required(money(GARAGE_TOTAL), `Total TTC : ${eur(GARAGE_TOTAL)}`),
    reference: required(GARAGE_INVOICE, GARAGE_INVOICE),
  }),
  fields: [plateField, field(MILEAGE_NAMES, 'number', required(84210, '84 210 km'))],
  key_dates: [noKeyDate('due')],
  subjects: [about(SUBJECTS.car)],
  facts: [
    fact('The garage serviced the car and fitted two tyres for 398.40 EUR on 2025-02-12.', {
      entities: [PARTIES.garage.key],
      subjects: [SUBJECTS.car.key],
      amounts: [money(GARAGE_TOTAL)],
    }),
  ],
});

const garageInvoice: ScenarioDocument = {
  id: 'garage-invoice-2025-02',
  description: 'Garage invoice for the yearly service and two tyres of the car',
  render: pdf(garageLines),
  truth: garageTruth,
};

// The paper copy of the same invoice, photographed: another file, the same document.
const garageInvoicePhoto: ScenarioDocument = {
  id: 'garage-invoice-photo',
  description: 'Phone photo of the printed garage invoice, the same paper as the PDF',
  render: { kind: 'image', encoding: 'jpeg', paper: 'photo', lines: garageLines },
  truth: { ...garageTruth, near_duplicate_of: garageInvoice.id, hard_cases: ['near_duplicate'] },
};

const INSPECTION_DATE = '2025-02-20';
const INSPECTION_VALID_UNTIL = '2027-02-19';
const INSPECTION_NUMBER = `CT-2025-${seededDigits('inspection', 6)}`;

const inspection: ScenarioDocument = {
  id: 'vehicle-inspection-2025-02',
  description: 'Roadworthiness test report of the car, valid two years, scanned',
  render: scannedPdf('scan', [
    ...letterhead('inspection', 'Centre agréé n° S099X042'),
    `PROCÈS-VERBAL DE CONTRÔLE TECHNIQUE N° ${INSPECTION_NUMBER}`,
    `Date du contrôle : ${frDate(INSPECTION_DATE)}`,
    'Nature : contrôle technique périodique',
    '',
    `Véhicule : ${CAR.model} - immatriculation ${CAR.plate}`,
    `Numéro de série : ${CAR.vin}`,
    'Kilométrage relevé : 84 312 km',
    'Titulaire : Mme Jane Doe',
    '',
    'Résultat : FAVORABLE',
    'Défaillances mineures : usure irrégulière du pneu arrière gauche ;',
    "balai d'essuie-glace arrière détérioré.",
    'Défaillances majeures : aucune',
    '',
    'Validité : le prochain contrôle doit avoir lieu au plus tard le',
    `${frDate(INSPECTION_VALID_UNTIL)}.`,
    '',
    `Prix du contrôle : ${eur(78)} TTC, réglé par carte bancaire.`,
  ]),
  truth: truth({
    type: TYPES.inspectionReport,
    core: core('fr', {
      document_date: required(INSPECTION_DATE, frDate(INSPECTION_DATE)),
      issuer: required(PARTIES.inspection.key, PARTIES.inspection.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(78), eur(78)),
      reference: required(INSPECTION_NUMBER, INSPECTION_NUMBER),
    }),
    fields: [
      plateField,
      field(MILEAGE_NAMES, 'number', optional(84312, '84 312 km')),
      field(['result', 'outcome', 'inspection_result'], 'text', optional('favorable', 'FAVORABLE')),
    ],
    key_dates: [keyDate(['expiry', 'due'], INSPECTION_VALID_UNTIL, frDate(INSPECTION_VALID_UNTIL))],
    subjects: [about(SUBJECTS.car)],
    facts: [
      fact(
        'The car passed its roadworthiness test on 2025-02-20; the next one is due by 2027-02-19.',
        {
          subjects: [SUBJECTS.car.key],
          dates: [INSPECTION_VALID_UNTIL],
        },
      ),
    ],
  }),
};

const FINE_DATE = '2025-05-14';
const OFFENCE_DATE = '2025-05-06';
const FINE_DUE = '2025-06-28';
const FINE_NUMBER = `99${seededDigits('fine', 10)}`;

const fine: ScenarioDocument = {
  id: 'parking-fine-2025-05',
  description: 'Parking fine notice for the car, scanned',
  render: scannedPdf('scan', [
    ...letterhead('finesAgency'),
    'AVIS DE CONTRAVENTION',
    `Numéro de l'avis : ${FINE_NUMBER}`,
    `Date de l'avis : ${frDate(FINE_DATE)}`,
    '',
    'Destinataire : Mme Jane Doe',
    HOME_ADDRESS,
    "Titulaire du certificat d'immatriculation du véhicule",
    `${CAR.plate} (${CAR.model})`,
    '',
    'Infraction : stationnement gênant sur un emplacement réservé aux',
    'livraisons',
    `Date et heure : ${frDate(OFFENCE_DATE)} à 10 h 42`,
    'Lieu : rue des Halles, Valmont-sur-Orbe',
    'Agent verbalisateur n° 0417',
    '',
    `Amende forfaitaire : ${eur(35)}`,
    `À payer avant le ${frDate(FINE_DUE)} (45 jours).`,
    `Passé ce délai, l'amende est majorée à ${eur(75)}.`,
    'Aucun retrait de point.',
    '',
    "Pour contester : adressez une requête motivée à l'agence dans les",
    "45 jours, en rappelant le numéro de l'avis.",
  ]),
  truth: truth({
    type: TYPES.fineNotice,
    core: core('fr', {
      document_date: required(FINE_DATE, frDate(FINE_DATE)),
      issuer: required(PARTIES.finesAgency.key, PARTIES.finesAgency.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(35), `Amende forfaitaire : ${eur(35)}`),
      due_date: required(FINE_DUE, frDate(FINE_DUE)),
      reference: required(FINE_NUMBER, FINE_NUMBER),
    }),
    fields: [
      plateField,
      field(
        ['offence_date', 'offense_date', 'violation_date', 'infraction_date'],
        'date',
        optional(OFFENCE_DATE, frDate(OFFENCE_DATE)),
      ),
      field(
        ['increased_amount', 'increased_fine', 'late_amount'],
        'money',
        optional(money(75), eur(75)),
      ),
    ],
    key_dates: [
      keyDate('due', FINE_DUE, frDate(FINE_DUE)),
      keyDate('event', OFFENCE_DATE, frDate(OFFENCE_DATE), 'optional'),
    ],
    subjects: [about(SUBJECTS.car)],
    facts: [
      fact('A parking fine of 35 EUR was issued for the car, payable by 2025-06-28.', {
        entities: [PARTIES.finesAgency.key],
        amounts: [money(35)],
        dates: [FINE_DUE],
      }),
    ],
  }),
};

const CONTEST_DATE = '2025-05-22';

const contestLetter: ScenarioDocument = {
  id: 'parking-fine-contest-letter',
  description: 'Letter from Jane Doe contesting the parking fine notice',
  render: pdf([
    ...SENDER,
    "Agence de Traitement des Contraventions de l'Orbe",
    'CS 40017, 99309 Port-Lanvec Cedex',
    '',
    `Valmont-sur-Orbe, le ${frDate(CONTEST_DATE)}`,
    'Lettre recommandée avec accusé de réception',
    '',
    `Objet : contestation de l'avis de contravention n° ${FINE_NUMBER}`,
    '',
    'Madame, Monsieur,',
    '',
    ...wrap(
      `Je conteste l'avis de contravention n° ${FINE_NUMBER} daté du ${frDate(FINE_DATE)}, relatif à un stationnement gênant relevé le ${frDate(OFFENCE_DATE)} rue des Halles à Valmont-sur-Orbe.`,
    ),
    '',
    ...wrap(
      `Ce jour-là, mon véhicule immatriculé ${CAR.plate} se trouvait au Garage du Belvédère pour le remplacement de son pare-brise, de 8 h 30 à 17 h. Il ne pouvait donc pas être stationné rue des Halles à 10 h 42. Je pense qu'une erreur a été commise lors du relevé de la plaque.`,
    ),
    '',
    "Je vous demande en conséquence l'annulation de cet avis.",
    'Veuillez agréer, Madame, Monsieur, mes salutations distinguées.',
    '',
    'Jane Doe',
    "Pièces jointes : copie de l'avis, attestation du garage",
  ]),
  truth: truth({
    type: TYPES.contestLetter,
    core: core('fr', {
      document_date: required(CONTEST_DATE, frDate(CONTEST_DATE)),
      issuer: required(PARTIES.jane.key, 'Jane Doe'),
      recipient: required(
        PARTIES.finesAgency.key,
        "Agence de Traitement des Contraventions de l'Orbe",
      ),
      reference: required(FINE_NUMBER, FINE_NUMBER),
    }),
    fields: [{ ...plateField, expectation: optional(CAR.plate, CAR.plate) }],
    links: [link('replies_to', fine.id)],
    subjects: [about(SUBJECTS.car)],
    facts: [
      fact(
        'Jane Doe contested the parking fine on 2025-05-22: the car was at the garage that day.',
        {
          entities: [PARTIES.finesAgency.key],
          dates: [CONTEST_DATE],
        },
      ),
    ],
  }),
};

// Three short lines: almost nothing to read, and nothing more to find.
const parkingTicket: ScenarioDocument = {
  id: 'parking-ticket-2025-10',
  description: 'Screenshot of a car park ticket: a name, a time and a price',
  render: {
    kind: 'image',
    encoding: 'png',
    paper: 'screen',
    lines: ['PARKING DU BELVEDERE', '12/10/2025 14:32', '4,50 EUR'],
  },
  truth: truth({
    type: TYPES.parkingReceipt,
    hard_cases: ['little_text'],
    core: {
      ...core('fr', {
        document_date: optional('2025-10-12', '12/10/2025'),
        issuer: optional(PARTIES.parking.key, 'PARKING DU BELVEDERE'),
        amount: optional(money(4.5), '4,50 EUR'),
      }),
      // Five words are not enough to be sure of a language.
      language: optional('fr', null),
    },
    key_dates: [noKeyDate('due', 'expiry', 'renewal', 'notice_deadline', 'effective')],
  }),
};

export const VEHICLE_DOCUMENTS: readonly ScenarioDocument[] = [
  garageInvoice,
  garageInvoicePhoto,
  inspection,
  fine,
  contestLetter,
  parkingTicket,
];
