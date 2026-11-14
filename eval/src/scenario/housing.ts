import { CONTRACTS, HOME_ADDRESS, METER_ID, PARTIES, SUBJECTS } from './cast.ts';
import { eur, frDate } from '../format.ts';
import { letterhead } from './layout.ts';
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

const AGENCY_CONTACT = 'Tél. 01 99 00 18 45';
const LEASE_SIGNED = '2023-01-20';
const LEASE_START = '2023-02-01';
const LEASE_END = '2026-01-31';
const RENT = 780;
const CHARGES = 60;

const lease: ScenarioDocument = {
  id: 'lease',
  description:
    'Lease of the flat: two pages with a text layer and a scanned inventory as third page',
  render: {
    kind: 'pdf',
    pages: [
      {
        lines: [
          ...letterhead('agency', AGENCY_CONTACT),
          'CONTRAT DE LOCATION - LOGEMENT NON MEUBLÉ',
          `Bail n° ${CONTRACTS.lease}`,
          '',
          'Entre les soussignés :',
          'Le bailleur : M. Hector Vasseur, 31 route des Crêtes, 99150 Montbrisac,',
          "représenté par l'Agence Immobilière du Belvédère, mandataire,",
          'et les locataires : Mme Jane Doe et M. Malo Kerven.',
          '',
          'Article 1 - Désignation du logement',
          'Appartement de trois pièces de 68 m², au 2e étage, avec une cave,',
          `${HOME_ADDRESS}.`,
          '',
          'Article 2 - Durée',
          'Le bail est conclu pour une durée de trois ans à compter du',
          `${frDate(LEASE_START)}. Il prend fin le ${frDate(LEASE_END)}.`,
          "À défaut de congé donné par l'une des parties, il est reconduit",
          'tacitement pour trois ans.',
          '',
          'Article 3 - Congé',
          'Le locataire peut donner congé à tout moment, avec un préavis de',
          'trois mois. Le bailleur peut donner congé pour le terme du bail, avec',
          'un préavis de six mois.',
          '',
          'Article 4 - Loyer et charges',
          `Loyer mensuel : ${eur(RENT)} ; provision pour charges : ${eur(CHARGES)} ;`,
          `soit ${eur(RENT + CHARGES)} par mois, payables d'avance le 5 de chaque mois.`,
          "Le loyer est révisé chaque année au 1er février selon l'indice de",
          'référence des loyers.',
        ],
      },
      {
        lines: [
          `Bail n° ${CONTRACTS.lease} - page 2`,
          '',
          'Article 5 - Dépôt de garantie',
          `Un dépôt de garantie de ${eur(RENT)} est versé à la signature du bail.`,
          'Il est restitué dans un délai de deux mois après la remise des clés.',
          '',
          'Article 6 - Assurance',
          "Le locataire justifie chaque année d'une assurance couvrant les",
          'risques locatifs.',
          '',
          'Article 7 - Usage des lieux',
          "Le logement est loué à usage d'habitation principale. Toute",
          "sous-location est interdite sans l'accord écrit du bailleur.",
          '',
          'Article 8 - État des lieux',
          "Un état des lieux d'entrée est établi le jour de la remise des clés",
          'et annexé au présent bail.',
          '',
          `Fait à Valmont-sur-Orbe, le ${frDate(LEASE_SIGNED)}, en trois exemplaires.`,
          '',
          'Le bailleur, par son mandataire : Agence Immobilière du Belvédère',
          'Les locataires : Jane Doe - Malo Kerven',
        ],
      },
      {
        scan: 'scan',
        lines: [
          `ÉTAT DES LIEUX D'ENTRÉE - ANNEXE AU BAIL N° ${CONTRACTS.lease}`,
          `Logement : ${HOME_ADDRESS}`,
          `Date : ${frDate(LEASE_START)}`,
          '',
          'Relevé des compteurs',
          `Électricité (PDL ${METER_ID}) : 18 204 kWh`,
          'Eau froide : 412 m3',
          '',
          'Clés remises : 3 clés de porte, 1 clé de cave, 2 badges',
          '',
          'Entrée : murs en bon état, sol en bon état',
          'Séjour : murs en bon état, parquet rayé près de la fenêtre',
          'Cuisine : plaque de cuisson et hotte en état de marche',
          'Chambre 1 : bon état',
          'Chambre 2 : tache au plafond, côté fenêtre',
          'Salle de bain : joints de la baignoire à refaire',
          'Cave : vide et propre',
          '',
          "Signatures : Jane Doe - Malo Kerven - pour le bailleur, l'agence",
        ],
      },
    ],
  },
  truth: truth({
    type: TYPES.lease,
    hard_cases: ['mixed_pdf'],
    core: core('fr', {
      document_date: required(LEASE_SIGNED, frDate(LEASE_SIGNED)),
      issuer: required(PARTIES.agency.key, PARTIES.agency.printed, [PARTIES.landlord.key]),
      recipient: required(PARTIES.jane.key, 'Jane Doe', [PARTIES.malo.key]),
      amount: optional(money(RENT + CHARGES), eur(RENT + CHARGES), [money(RENT)]),
      period: optional({ start: LEASE_START, end: LEASE_END }, null),
      reference: required(CONTRACTS.lease, CONTRACTS.lease),
    }),
    fields: [
      field(['monthly_rent', 'rent', 'rent_amount'], 'money', required(money(RENT), eur(RENT))),
      field(['deposit', 'security_deposit'], 'money', required(money(RENT), eur(RENT))),
      field(
        ['charges', 'monthly_charges', 'service_charges'],
        'money',
        optional(money(CHARGES), eur(CHARGES)),
      ),
      field(['landlord', 'lessor'], 'entity', optional('Hector Vasseur', 'Hector Vasseur')),
      field(['tenant_notice_months', 'notice_period_months'], 'number', optional(3, 'trois mois')),
    ],
    key_dates: [
      keyDate('effective', LEASE_START, frDate(LEASE_START)),
      keyDate(['expiry', 'renewal'], LEASE_END, frDate(LEASE_END)),
    ],
    subjects: [about(SUBJECTS.home), about(SUBJECTS.lease)],
    facts: [
      fact('The lease of the flat runs from 2023-02-01 to 2026-01-31 and renews tacitly.', {
        subjects: [SUBJECTS.home.key],
        dates: [LEASE_START, LEASE_END],
      }),
      fact('The monthly rent is 780 EUR plus 60 EUR of charges.', { amounts: [money(RENT)] }),
    ],
  }),
};

const RECEIPT_DATE = '2025-11-05';
const RECEIPT_NUMBER = 'Q-2025-11-0117';

const rentReceipt: ScenarioDocument = {
  id: 'rent-receipt-2025-11',
  description: 'Rent receipt for November 2025 from the letting agency, as a DOCX',
  render: {
    kind: 'docx',
    lines: [
      PARTIES.agency.printed,
      PARTIES.agency.address,
      '',
      `QUITTANCE DE LOYER N° ${RECEIPT_NUMBER}`,
      `Valmont-sur-Orbe, le ${frDate(RECEIPT_DATE)}`,
      '',
      'Locataires : Mme Jane Doe et M. Malo Kerven',
      `Logement : ${HOME_ADDRESS}`,
      `Bail n° ${CONTRACTS.lease} - Bailleur : M. Hector Vasseur`,
      '',
      `Période : du ${frDate('2025-11-01')} au ${frDate('2025-11-30')}`,
      `Loyer : ${eur(RENT)}`,
      `Provision pour charges : ${eur(CHARGES)}`,
      `Total reçu : ${eur(RENT + CHARGES)}`,
      '',
      `L'agence, mandataire du bailleur, reconnaît avoir reçu de Mme Jane Doe la somme de ${eur(RENT + CHARGES)} par virement le ${frDate(RECEIPT_DATE)}, au titre du loyer et des charges de la période ci-dessus, et lui en donne quittance, sous réserve de tous ses droits.`,
    ],
  },
  truth: truth({
    type: TYPES.rentReceipt,
    core: core('fr', {
      document_date: required(RECEIPT_DATE, frDate(RECEIPT_DATE)),
      issuer: required(PARTIES.agency.key, PARTIES.agency.printed, [PARTIES.landlord.key]),
      recipient: required(PARTIES.jane.key, 'Jane Doe', [PARTIES.malo.key]),
      amount: required(money(RENT + CHARGES), `Total reçu : ${eur(RENT + CHARGES)}`),
      period: required(
        { start: '2025-11-01', end: '2025-11-30' },
        `du ${frDate('2025-11-01')} au ${frDate('2025-11-30')}`,
      ),
      reference: required(RECEIPT_NUMBER, RECEIPT_NUMBER, [CONTRACTS.lease]),
    }),
    fields: [
      field(['rent', 'monthly_rent', 'rent_amount'], 'money', optional(money(RENT), eur(RENT))),
      field(
        ['charges', 'monthly_charges', 'service_charges'],
        'money',
        optional(money(CHARGES), eur(CHARGES)),
      ),
    ],
    key_dates: [noKeyDate('due')],
    subjects: [about(SUBJECTS.home), about(SUBJECTS.lease, 'optional')],
    facts: [
      fact('The agency received 840 EUR for the rent and charges of November 2025.', {
        entities: [PARTIES.agency.key],
        amounts: [money(RENT + CHARGES)],
      }),
    ],
  }),
};

export const HOUSING_DOCUMENTS: readonly ScenarioDocument[] = [lease, rentReceipt];
