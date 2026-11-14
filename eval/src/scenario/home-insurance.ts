import { CONTRACTS, HOME_ADDRESS, IBAN_TAIL, PARTIES, SUBJECTS } from './cast.ts';
import { eur, frDate } from '../format.ts';
import { ADDRESSEE, letterhead, pdf, scannedPdf } from './layout.ts';
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

const CORBELIN_CONTACT = 'Service clients : 01 99 00 24 60';
const HOME_POLICY = CONTRACTS.homeInsurance;
const HOME_EFFECTIVE = '2023-03-01';
const HOME_PREMIUM_2023 = 214.8;
const HOME_PREMIUM_2024 = 236.4;
const HOME_PREMIUM_2026 = 243.1;

const homeContract: ScenarioDocument = {
  id: 'home-insurance-contract',
  description: 'Home insurance contract with automatic yearly renewal and a two-month notice',
  render: pdf([
    ...letterhead('corbelin', CORBELIN_CONTACT),
    "CONTRAT D'ASSURANCE HABITATION - CONDITIONS PARTICULIÈRES",
    `Contrat n° ${HOME_POLICY}`,
    `Établi le ${frDate('2023-02-14')}`,
    '',
    'Souscripteur : Mme Jane Doe',
    'Logement assuré : appartement de 3 pièces, 68 m², occupé en location,',
    HOME_ADDRESS,
    '',
    'Garanties : incendie, dégât des eaux, vol, bris de glace,',
    'responsabilité civile vie privée, risques locatifs.',
    'Capital mobilier assuré : 25 000 € - Franchise : 150 € par sinistre',
    '',
    `Date d'effet : ${frDate(HOME_EFFECTIVE)}`,
    'Échéance annuelle : le 1er mars de chaque année',
    `Première échéance : ${frDate('2024-03-01')}`,
    "Le contrat est reconduit automatiquement d'année en année à chaque",
    'échéance.',
    '',
    "Résiliation : vous pouvez résilier le contrat à l'échéance, en nous",
    'prévenant au moins deux mois avant, par lettre recommandée.',
    '',
    `Cotisation annuelle TTC : ${eur(HOME_PREMIUM_2023)}, payable à l'échéance par`,
    `prélèvement sur le compte se terminant par ${IBAN_TAIL}.`,
    '',
    'Fait à Corbelin-la-Forêt en deux exemplaires.',
    "Pour l'assureur : Assurances Corbelin - Le souscripteur : Jane Doe",
  ]),
  truth: truth({
    type: TYPES.homeInsuranceContract,
    core: core('fr', {
      document_date: required('2023-02-14', frDate('2023-02-14')),
      issuer: required(PARTIES.corbelin.key, PARTIES.corbelin.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(HOME_PREMIUM_2023), eur(HOME_PREMIUM_2023)),
      period: optional({ start: HOME_EFFECTIVE, end: '2024-02-29' }, null),
      reference: required(HOME_POLICY, HOME_POLICY),
    }),
    fields: [
      field(
        ['notice_period_months', 'notice_period', 'cancellation_notice_months'],
        'number',
        required(2, 'deux mois'),
      ),
      field(
        ['annual_premium', 'premium', 'yearly_premium'],
        'money',
        optional(money(HOME_PREMIUM_2023), eur(HOME_PREMIUM_2023)),
      ),
      field(['deductible', 'excess'], 'money', optional(money(150), '150 €')),
      field(
        ['automatic_renewal', 'auto_renewal', 'tacit_renewal'],
        'boolean',
        optional(true, 'reconduit automatiquement'),
      ),
    ],
    key_dates: [
      keyDate('effective', HOME_EFFECTIVE, frDate(HOME_EFFECTIVE)),
      keyDate('renewal', '2024-03-01', frDate('2024-03-01')),
      // The renewal minus the notice period, which the pipeline computes itself.
      keyDate('notice_deadline', '2024-01-01', null, 'optional'),
    ],
    subjects: [about(SUBJECTS.homeInsurance), about(SUBJECTS.home)],
    facts: [
      fact(
        'The Corbelin home insurance renews automatically every 1 March; notice of two months.',
        { entities: [PARTIES.corbelin.key], subjects: [SUBJECTS.homeInsurance.key] },
      ),
      fact('The home insurance took effect on 2023-03-01 for 214.80 EUR a year.', {
        entities: [PARTIES.corbelin.key],
        dates: [HOME_EFFECTIVE],
        amounts: [money(HOME_PREMIUM_2023)],
      }),
    ],
  }),
};

const AMENDMENT_EFFECTIVE = '2024-10-01';

const homeAmendment: ScenarioDocument = {
  id: 'home-insurance-amendment',
  description: 'Amendment to the home insurance contract adding theft cover for an e-bike, scanned',
  render: scannedPdf('scan', [
    ...letterhead('corbelin', CORBELIN_CONTACT),
    `AVENANT N° 1 AU CONTRAT D'ASSURANCE HABITATION N° ${HOME_POLICY}`,
    `Établi le ${frDate('2024-09-10')}`,
    '',
    'Souscripteur : Mme Jane Doe',
    `Logement assuré : ${HOME_ADDRESS}`,
    '',
    "Objet de l'avenant : extension de la garantie vol aux vélos à",
    'assistance électrique, à la demande du souscripteur.',
    'Bien ajouté : vélo Fernway E-Tourer, valeur 1 480 €, facture du',
    `${frDate('2024-08-17')}.`,
    '',
    `Date d'effet de l'avenant : ${frDate(AMENDMENT_EFFECTIVE)}`,
    `Nouvelle cotisation annuelle TTC : ${eur(HOME_PREMIUM_2024)}`,
    `(ancienne cotisation : ${eur(HOME_PREMIUM_2023)})`,
    `Complément dû pour la période du ${frDate(AMENDMENT_EFFECTIVE)} au`,
    `${frDate('2025-02-28')} : ${eur(9)}`,
    '',
    'Les autres clauses du contrat demeurent inchangées, notamment',
    "l'échéance annuelle du 1er mars et le préavis de résiliation de deux",
    'mois.',
    '',
    'Fait à Corbelin-la-Forêt en deux exemplaires.',
    "Pour l'assureur : Assurances Corbelin - Le souscripteur : Jane Doe",
  ]),
  truth: truth({
    type: TYPES.contractAmendment,
    core: core('fr', {
      document_date: required('2024-09-10', frDate('2024-09-10')),
      issuer: required(PARTIES.corbelin.key, PARTIES.corbelin.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: optional(money(HOME_PREMIUM_2024), eur(HOME_PREMIUM_2024), [money(9)]),
      period: optional({ start: AMENDMENT_EFFECTIVE, end: '2025-02-28' }, null),
      reference: required(HOME_POLICY, HOME_POLICY),
    }),
    fields: [
      field(
        ['annual_premium', 'new_annual_premium', 'premium'],
        'money',
        required(money(HOME_PREMIUM_2024), eur(HOME_PREMIUM_2024)),
      ),
      field(['amendment_number'], 'number', optional(1, 'AVENANT N° 1')),
    ],
    key_dates: [keyDate('effective', AMENDMENT_EFFECTIVE, frDate(AMENDMENT_EFFECTIVE))],
    links: [link('amends', homeContract.id)],
    subjects: [about(SUBJECTS.homeInsurance), about(SUBJECTS.home, 'optional')],
    facts: [
      fact(
        'From 2024-10-01 the home insurance covers the theft of an e-bike and costs 236.40 EUR a year.',
        {
          entities: [PARTIES.corbelin.key],
          dates: [AMENDMENT_EFFECTIVE],
          amounts: [money(HOME_PREMIUM_2024)],
        },
      ),
    ],
  }),
};

const HOME_RENEWAL = '2026-03-01';
const HOME_NOTICE_DEADLINE = '2026-01-01';

const homeRenewalNotice: ScenarioDocument = {
  id: 'home-insurance-renewal-2026',
  description:
    'Renewal notice of the home insurance for March 2026, with the last day to give notice',
  render: pdf([
    ...letterhead('corbelin', CORBELIN_CONTACT),
    ...ADDRESSEE,
    "AVIS D'ÉCHÉANCE - ASSURANCE HABITATION",
    `Contrat n° ${HOME_POLICY}`,
    `Corbelin-la-Forêt, le ${frDate('2025-12-18')}`,
    '',
    'Madame,',
    '',
    `Votre contrat d'assurance habitation arrive à échéance le ${frDate(HOME_RENEWAL)}.`,
    'Il sera reconduit automatiquement pour un an,',
    `du ${frDate(HOME_RENEWAL)} au ${frDate('2027-02-28')}.`,
    '',
    `Cotisation annuelle TTC : ${eur(HOME_PREMIUM_2026)}`,
    `Date de prélèvement : ${frDate(HOME_RENEWAL)}, sur le compte se terminant par ${IBAN_TAIL}`,
    '',
    'Si vous ne souhaitez pas reconduire ce contrat, vous pouvez le résilier',
    `par lettre recommandée reçue au plus tard le ${frDate(HOME_NOTICE_DEADLINE)}, soit deux`,
    "mois avant l'échéance.",
    '',
    'Votre conseiller Assurances Corbelin',
  ]),
  truth: truth({
    type: TYPES.renewalNotice,
    core: core('fr', {
      document_date: required('2025-12-18', frDate('2025-12-18')),
      issuer: required(PARTIES.corbelin.key, PARTIES.corbelin.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(HOME_PREMIUM_2026), eur(HOME_PREMIUM_2026)),
      period: required(
        { start: HOME_RENEWAL, end: '2027-02-28' },
        `du ${frDate(HOME_RENEWAL)} au ${frDate('2027-02-28')}`,
      ),
      due_date: required(HOME_RENEWAL, `Date de prélèvement : ${frDate(HOME_RENEWAL)}`),
      reference: required(HOME_POLICY, HOME_POLICY),
    }),
    key_dates: [
      keyDate('renewal', HOME_RENEWAL, `arrive à échéance le ${frDate(HOME_RENEWAL)}`),
      keyDate('notice_deadline', HOME_NOTICE_DEADLINE, frDate(HOME_NOTICE_DEADLINE)),
      keyDate('due', HOME_RENEWAL, `Date de prélèvement : ${frDate(HOME_RENEWAL)}`, 'optional'),
    ],
    subjects: [about(SUBJECTS.homeInsurance), about(SUBJECTS.home, 'optional')],
    facts: [
      fact('The home insurance renews on 2026-03-01 for 243.10 EUR; notice until 2026-01-01.', {
        entities: [PARTIES.corbelin.key],
        dates: [HOME_RENEWAL],
        amounts: [money(HOME_PREMIUM_2026)],
      }),
    ],
  }),
};

export const HOME_INSURANCE_DOCUMENTS: readonly ScenarioDocument[] = [
  homeContract,
  homeAmendment,
  homeRenewalNotice,
];
