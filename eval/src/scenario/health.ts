import { seededDigits } from '../identifiers.ts';
import { IBAN_TAIL, PARTIES } from './cast.ts';
import { eur, frDate } from '../format.ts';
import { letterhead, pdf } from './layout.ts';
import {
  core,
  fact,
  field,
  money,
  noKeyDate,
  optional,
  required,
  type ScenarioDocument,
  truth,
} from './model.ts';
import { TYPES } from './types.ts';
const CARE_DATE = '2025-06-12';
const LAB_FILE = `L-2025-${seededDigits('lab', 6)}`;

const labReport: ScenarioDocument = {
  id: 'lab-report-2025-06',
  description: 'Blood test report from a medical laboratory',
  render: pdf([
    'LABORATOIRE DES SORBIERS - Biologie médicale',
    `${PARTIES.lab.address} - Tél. 01 99 00 44 09`,
    '',
    "COMPTE RENDU D'ANALYSES",
    `Dossier n° ${LAB_FILE}`,
    'Patiente : Mme Jane Doe',
    `Prélèvement du ${frDate(CARE_DATE)} à 8 h 10 - Résultats édités le ${frDate(CARE_DATE)}`,
    'Prescripteur : Dr Anselme Rouvière',
    '',
    'Hématologie',
    'Hémoglobine : 13,4 g/dL (valeurs de référence : 12,0 - 16,0)',
    'Leucocytes : 6,2 G/L (4,0 - 10,0)',
    'Plaquettes : 245 G/L (150 - 400)',
    '',
    'Biochimie',
    'Glycémie à jeun : 0,92 g/L (0,70 - 1,10)',
    'Cholestérol total : 2,31 g/L (inférieur à 2,00) *',
    'Ferritine : 18 ng/mL (15 - 150)',
    '',
    "* Valeur en dehors de l'intervalle de référence",
    'Résultats validés par le biologiste : Dr Mireille Castagnet',
  ]),
  truth: truth({
    type: TYPES.labReport,
    hard_cases: ['private'],
    core: core('fr', {
      document_date: required(CARE_DATE, frDate(CARE_DATE)),
      issuer: required(PARTIES.lab.key, PARTIES.lab.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      reference: required(LAB_FILE, LAB_FILE),
    }),
    fields: [
      field(
        ['prescriber', 'prescribing_doctor', 'doctor'],
        'text',
        optional('Anselme Rouvière', 'Anselme Rouvière'),
      ),
    ],
    key_dates: [noKeyDate('due', 'expiry', 'renewal')],
    facts: [
      fact('A blood test of 2025-06-12 found total cholesterol above the reference range.', {
        entities: [PARTIES.lab.key],
        dates: [CARE_DATE],
      }),
    ],
    private: 'required',
  }),
};

const STATEMENT_DATE = '2025-06-25';
const STATEMENT_NUMBER = `D-2025-${seededDigits('mutual', 6)}`;
const MEMBER_NUMBER = `MS${seededDigits('mutual-member', 7)}`;

const healthStatement: ScenarioDocument = {
  id: 'health-reimbursement-2025-06',
  description: 'Reimbursement statement from the health mutual for the laboratory tests',
  render: pdf([
    ...letterhead('mutual', 'Service adhérents : 01 99 00 66 21'),
    `DÉCOMPTE DE REMBOURSEMENT N° ${STATEMENT_NUMBER}`,
    `Corbelin-la-Forêt, le ${frDate(STATEMENT_DATE)}`,
    '',
    `Adhérente : Mme Jane Doe - n° d'adhérent ${MEMBER_NUMBER}`,
    '',
    `Soins du ${frDate(CARE_DATE)} - Laboratoire des Sorbiers`,
    'Nature : analyses de biologie médicale',
    `Montant des soins : ${eur(46)}`,
    `Remboursement de l'assurance maladie : ${eur(27.6)}`,
    `Remboursement de la mutuelle : ${eur(18.4)}`,
    `Reste à votre charge : ${eur(0)}`,
    '',
    `Virement de ${eur(18.4)} effectué le ${frDate(STATEMENT_DATE)} sur le compte se terminant`,
    `par ${IBAN_TAIL}.`,
  ]),
  truth: truth({
    type: TYPES.healthStatement,
    core: core('fr', {
      document_date: required(STATEMENT_DATE, frDate(STATEMENT_DATE)),
      issuer: required(PARTIES.mutual.key, PARTIES.mutual.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(18.4), `Remboursement de la mutuelle : ${eur(18.4)}`, [money(46)]),
      reference: required(STATEMENT_NUMBER, STATEMENT_NUMBER),
    }),
    fields: [
      field(
        ['care_date', 'treatment_date', 'service_date'],
        'date',
        optional(CARE_DATE, frDate(CARE_DATE)),
      ),
      field(
        ['member_number', 'member_id', 'policy_number'],
        'identifier',
        optional(MEMBER_NUMBER, MEMBER_NUMBER),
      ),
    ],
    key_dates: [noKeyDate('due')],
    facts: [
      fact('The health mutual reimbursed 18.40 EUR for the laboratory tests of 2025-06-12.', {
        entities: [PARTIES.mutual.key],
        amounts: [money(18.4)],
      }),
    ],
    private: 'optional',
  }),
};

export const HEALTH_DOCUMENTS: readonly ScenarioDocument[] = [labReport, healthStatement];
