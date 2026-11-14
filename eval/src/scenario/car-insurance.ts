import { CAR, CONTRACTS, IBAN_TAIL, PARTIES, SUBJECTS } from './cast.ts';
import { addDays, addMonths } from '../calendar.ts';
import { eur, frDate } from '../format.ts';
import { letterhead, pdf } from './layout.ts';
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
const ROULAVIE_CONTACT = 'Service clients : 01 99 00 58 02';
const PLATE_NAMES = [
  'license_plate',
  'registration_number',
  'plate_number',
  'vehicle_registration',
];

interface CarPolicy {
  readonly id: string;
  readonly description: string;
  readonly number: string;
  readonly issued: string;
  readonly effective: string;
  readonly premium: number;
  readonly cover: string;
  readonly deductible: number;
  // The contract this one replaces, and its number as printed.
  readonly replaces?: { readonly id: string; readonly number: string };
  // The next renewal, when the contract prints it.
  readonly nextRenewal?: string;
}

const carPolicy = (policy: CarPolicy): ScenarioDocument => ({
  id: policy.id,
  description: policy.description,
  render: pdf([
    ...letterhead('roulavie', ROULAVIE_CONTACT),
    "CONTRAT D'ASSURANCE AUTOMOBILE - CONDITIONS PARTICULIÈRES",
    `Contrat n° ${policy.number}`,
    `Établi le ${frDate(policy.issued)}`,
    '',
    'Souscripteur et conducteur principal : Mme Jane Doe',
    `Véhicule assuré : ${CAR.model} - immatriculation ${CAR.plate}`,
    `Numéro de série : ${CAR.vin}`,
    `Première mise en circulation : ${frDate('2019-03-14')}`,
    `Formule : ${policy.cover}`,
    `Franchise : ${String(policy.deductible)} € - Bonus : coefficient 0,68`,
    '',
    `Date d'effet : ${frDate(policy.effective)}`,
    'Échéance annuelle : le 1er juin de chaque année, reconduction automatique',
    ...(policy.nextRenewal === undefined
      ? []
      : [`Prochaine échéance : ${frDate(policy.nextRenewal)}`]),
    "Résiliation : à l'échéance avec un préavis de deux mois, ou à tout moment",
    'après la première année.',
    ...(policy.replaces === undefined
      ? []
      : [
          '',
          `Le présent contrat annule et remplace le contrat n° ${policy.replaces.number}`,
          `à compter du ${frDate(policy.effective)}.`,
        ]),
    '',
    `Cotisation annuelle TTC : ${eur(policy.premium)}`,
    `Paiement par prélèvement sur le compte se terminant par ${IBAN_TAIL}.`,
    '',
    "Pour l'assureur : Roulavie Assurances - Le souscripteur : Jane Doe",
  ]),
  truth: truth({
    type: TYPES.carInsuranceContract,
    core: core('fr', {
      document_date: required(policy.issued, frDate(policy.issued)),
      issuer: required(PARTIES.roulavie.key, PARTIES.roulavie.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(policy.premium), eur(policy.premium)),
      // The first insured year, which the contract does not print as a period.
      period: optional(
        { start: policy.effective, end: addDays(addMonths(policy.effective, 12), -1) },
        null,
      ),
      reference: required(policy.number, policy.number),
    }),
    fields: [
      field(PLATE_NAMES, 'identifier', required(CAR.plate, CAR.plate)),
      field(
        ['vin', 'vehicle_identification_number', 'serial_number'],
        'identifier',
        optional(CAR.vin, CAR.vin),
      ),
      field(
        ['deductible', 'excess'],
        'money',
        optional(money(policy.deductible), `${String(policy.deductible)} €`),
      ),
    ],
    key_dates: [
      keyDate('effective', policy.effective, frDate(policy.effective)),
      ...(policy.nextRenewal === undefined
        ? []
        : [keyDate('renewal', policy.nextRenewal, frDate(policy.nextRenewal))]),
      noKeyDate('due'),
    ],
    links: policy.replaces === undefined ? [] : [link('supersedes', policy.replaces.id)],
    subjects: [about(SUBJECTS.car), about(SUBJECTS.carInsurance)],
    facts: [
      fact(
        `Roulavie insures the car ${CAR.plate} from ${policy.effective} for ${String(policy.premium)} EUR a year.`,
        {
          entities: [PARTIES.roulavie.key],
          subjects: [SUBJECTS.car.key],
          dates: [policy.effective],
          amounts: [money(policy.premium)],
        },
      ),
    ],
  }),
});

const FIRST_CAR_POLICY_ID = 'car-insurance-2023';

export const CAR_INSURANCE_DOCUMENTS: readonly ScenarioDocument[] = [
  carPolicy({
    id: FIRST_CAR_POLICY_ID,
    description: 'Car insurance contract of 2023, third-party cover, later replaced',
    number: CONTRACTS.carInsurance2023,
    issued: '2023-05-22',
    effective: '2023-06-01',
    premium: 412,
    cover: 'Tiers étendu (responsabilité civile, vol, incendie, bris de glace)',
    deductible: 380,
  }),
  carPolicy({
    id: 'car-insurance-2025',
    description: 'Car insurance contract of 2025, comprehensive cover, replacing the 2023 one',
    number: CONTRACTS.carInsurance2025,
    issued: '2025-05-19',
    effective: '2025-06-01',
    premium: 538.6,
    cover: 'Tous risques (dommages tous accidents, vol, incendie)',
    deductible: 290,
    replaces: { id: FIRST_CAR_POLICY_ID, number: CONTRACTS.carInsurance2023 },
    nextRenewal: '2026-06-01',
  }),
];
