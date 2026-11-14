import type { EntityKind } from '@liasse/core/domain';
import {
  cardNumber,
  frenchIban,
  seededDigits,
  siren,
  siret,
  socialSecurityNumber,
  taxNumber,
} from '../identifiers.ts';
import type { EntityTruth, SubjectDefinition } from '../schema/index.ts';

// Everyone and everything here is invented. The towns do not exist and their postcodes
// start with 99 (France), 00 (Germany, Spain) or use a made-up outward code (United
// Kingdom), which no postal service assigns. Phone numbers are in the ranges the French
// and British regulators reserve for fiction, and e-mail addresses on reserved domains.

// The day the household looks at its documents: every "now", "this quarter" and "still"
// of the reference questions is relative to it.
export const REFERENCE_DATE = '2026-01-15';

export interface Party extends EntityTruth {
  // The name as its letterhead prints it.
  readonly printed: string;
  readonly address: string;
}

const party = (
  key: string,
  kind: EntityKind,
  canonical_name: string,
  printed: string,
  address: string,
  aliases: readonly string[] = [],
  companyLabel?: string,
): Party => ({
  key,
  kind,
  canonical_name,
  aliases: [...aliases],
  identifiers:
    companyLabel === undefined ? [] : [{ type: 'company_id', value: siren(companyLabel) }],
  printed,
  address,
});

export const HOME_ADDRESS = '4 allée des Sorbiers, 99120 Valmont-sur-Orbe';
const TOWN = '99120 Valmont-sur-Orbe';

// prettier-ignore
export const PARTIES = {
  jane: party('jane-doe', 'person', 'Jane Doe', 'Jane Doe', HOME_ADDRESS, ['Mme Jane Doe', 'Madame Jane Doe', 'Ms Jane Doe', 'Doe Jane']),
  malo: party('malo-kerven', 'person', 'Malo Kerven', 'Malo Kerven', HOME_ADDRESS, ['M. Malo Kerven']),
  voltaneige: party('voltaneige', 'org', 'Voltaneige Energie', 'VOLTANEIGE ENERGIE SAS', `18 quai des Verriers, ${TOWN}`, ['Voltaneige'], 'voltaneige'),
  brisevent: party('brisevent', 'org', 'Brisevent Électricité', 'BRISEVENT ÉLECTRICITÉ SA', '3 place du Moulin-Neuf, 99300 Port-Lanvec', ['Brisevent'], 'brisevent'),
  telorca: party('telorca', 'org', 'Telorca', 'TELORCA SAS', '27 avenue des Câbliers, 99410 Sainte-Orme', ['Telorca Mobile'], 'telorca'),
  fibrenoix: party('fibrenoix', 'org', 'Fibrenoix', 'FIBRENOIX SAS', `5 rue du Noyer, ${TOWN}`, [], 'fibrenoix'),
  waterBoard: party('regie-des-eaux', 'org', "Régie des Eaux de l'Orbe", "RÉGIE DES EAUX DE L'ORBE", `1 chemin du Captage, ${TOWN}`, ['Régie des Eaux']),
  corbelin: party('corbelin', 'org', 'Assurances Corbelin', 'ASSURANCES CORBELIN SA', '40 boulevard des Tisserands, 99200 Corbelin-la-Forêt', ['Corbelin', 'Corbelin Assurances'], 'corbelin'),
  roulavie: party('roulavie', 'org', 'Roulavie Assurances', 'ROULAVIE ASSURANCES SA', '11 rue des Charrons, 99300 Port-Lanvec', ['Roulavie'], 'roulavie'),
  agency: party('agence-du-belvedere', 'org', 'Agence Immobilière du Belvédère', 'AGENCE IMMOBILIÈRE DU BELVÉDÈRE SARL', `2 place du Belvédère, ${TOWN}`, ['Agence du Belvédère'], 'agency'),
  landlord: party('hector-vasseur', 'person', 'Hector Vasseur', 'Hector Vasseur', '31 route des Crêtes, 99150 Montbrisac', ['M. Hector Vasseur']),
  employer: party('ostrelia', 'org', 'Ostrelia Conseil', 'OSTRELIA CONSEIL SAS', '8 rue des Imprimeurs, 99300 Port-Lanvec', ['Ostrelia'], 'ostrelia'),
  bank: party('credit-orbien', 'org', 'Crédit Orbien', 'CRÉDIT ORBIEN', `14 cours des Halles, ${TOWN}`, ['Credit Orbien'], 'credit-orbien'),
  taxOffice: party('centre-des-finances-publiques', 'org', 'Centre des Finances Publiques de Valmont-sur-Orbe', 'CENTRE DES FINANCES PUBLIQUES DE VALMONT-SUR-ORBE', `6 rue de la Trésorerie, ${TOWN}`, ['Service des impôts des particuliers de Valmont-sur-Orbe']),
  finesAgency: party('agence-des-contraventions', 'org', "Agence de Traitement des Contraventions de l'Orbe", "AGENCE DE TRAITEMENT DES CONTRAVENTIONS DE L'ORBE", 'CS 40017, 99309 Port-Lanvec Cedex', ["Agence de Traitement des Contraventions"]),
  garage: party('garage-du-belvedere', 'org', 'Garage du Belvédère', 'GARAGE DU BELVÉDÈRE SARL', `21 route de Montbrisac, ${TOWN}`, [], 'garage'),
  inspection: party('autobilan-valmont', 'org', 'Autobilan Valmont', 'AUTOBILAN VALMONT', `ZA des Gravières, ${TOWN}`, [], 'autobilan'),
  lab: party('laboratoire-des-sorbiers', 'org', 'Laboratoire des Sorbiers', 'LABORATOIRE DES SORBIERS', `9 allée des Sorbiers, ${TOWN}`),
  mutual: party('mutuelle-sorbier-sante', 'org', 'Mutuelle Sorbier Santé', 'MUTUELLE SORBIER SANTÉ', '55 rue des Drapiers, 99200 Corbelin-la-Forêt', ['Sorbier Santé']),
  bikeShop: party('brindlemoor-cycles', 'org', 'Brindlemoor Cycles', 'Brindlemoor Cycles Ltd', '7 Tannery Row, Brindlemoor, ZZ4 9QX, United Kingdom'),
  cloud: party('quillfern-cloud', 'org', 'Quillfern Cloud', 'Quillfern Cloud Inc.', '900 Example Parkway, Suite 12, Fernhollow, ZZ 00042, USA', ['Quillfern']),
  travelInsurer: party('northmere-travel-cover', 'org', 'Northmere Travel Cover', 'Northmere Travel Cover Ltd', '2 Quay Street, Northmere, ZZ1 4NM, United Kingdom', ['Northmere']),
  hotel: party('gasthof-lindenhoehe', 'org', 'Gasthof Lindenhöhe', 'Gasthof Lindenhöhe', 'Seeuferweg 3, 00917 Tannwald am See', ['Gasthof Lindenhoehe']),
  carRental: party('alquileres-sotomar', 'org', 'Alquileres Sotomar', 'Alquileres Sotomar S.L.', 'Avenida del Faro 18, 00420 Puerto Sotomar', ['Sotomar']),
  furniture: party('meubles-sauvageon', 'org', 'Meubles Sauvageon', 'MEUBLES SAUVAGEON', `33 rue du Lavoir, ${TOWN}`, ['Sauvageon']),
  hardware: party('bricorbe', 'org', 'Bricorbe', 'BRICORBE', `ZA des Gravières, ${TOWN}`),
  parking: party('parking-du-belvedere', 'org', 'Parking du Belvédère', 'PARKING DU BELVEDERE', `Place du Belvédère, ${TOWN}`, ['Parking du Belvedere']),
} as const satisfies Readonly<Record<string, Party>>;

export const OWNER = PARTIES.jane.key;

export const companyLine = (label: keyof typeof PARTIES): string => {
  const company = PARTIES[label].identifiers[0]?.value;
  return company === undefined ? '' : `SIREN ${company}`;
};

// Identifiers of the household. Each is well formed and belongs to nobody: see
// `identifiers.ts` for how they are built.
export const JANE = {
  email: 'jane.doe@example.org',
  mobile: '06 39 98 01 23',
  iban: frenchIban('jane'),
  card: (cardNumber('jane').match(/.{4}/g) ?? []).join(' '),
  socialSecurityNumber: socialSecurityNumber('jane'),
  taxNumber: taxNumber('jane'),
  employeeNumber: `M${seededDigits('employee', 4)}`,
} as const;

// The letters I, O and U and the pair SS never appear on a French plate.
export const CAR = {
  plate: 'SS-417-OU',
  model: 'Velanta Coriol 1.2',
  vin: `ZZ9LIASSE${seededDigits('vin', 8)}`,
} as const;

export const METER_ID = `99${seededDigits('meter', 12)}`;
export const EMPLOYER_SIRET = siret('ostrelia');

const lastFour = (value: string): string => value.replace(/\s/g, '').slice(-4);
export const IBAN_TAIL = lastFour(JANE.iban);
export const CARD_TAIL = lastFour(JANE.card);

export const CONTRACTS = {
  lease: 'BAIL-2023-0117',
  homeInsurance: `HAB-${seededDigits('home-insurance', 7)}`,
  carInsurance2023: `AUT-${seededDigits('car-insurance-2023', 7)}`,
  carInsurance2025: `AUT-${seededDigits('car-insurance-2025', 7)}`,
  voltaneige: `VE-${seededDigits('voltaneige-contract', 8)}`,
  brisevent: `BV-${seededDigits('brisevent-contract', 8)}`,
  mobile: `TM-${seededDigits('mobile-contract', 8)}`,
  internet: `FN-${seededDigits('internet-contract', 8)}`,
} as const;

const subject = (
  key: string,
  kind: SubjectDefinition['kind'],
  label: string,
  identifiers: readonly string[],
  aliases: readonly string[] = [],
): SubjectDefinition => ({
  key,
  kind,
  label,
  aliases: [...aliases],
  identifiers: [...identifiers],
});

// prettier-ignore
export const SUBJECTS = {
  home: subject('home', 'property', 'Appartement du 4 allée des Sorbiers, Valmont-sur-Orbe', ['4 allée des Sorbiers', METER_ID], ['Logement de Valmont-sur-Orbe']),
  car: subject('car', 'vehicle', `${CAR.model} ${CAR.plate}`, [CAR.plate, CAR.vin], ['Velanta Coriol']),
  lease: subject('lease', 'contract', 'Bail du 4 allée des Sorbiers', [CONTRACTS.lease], ['Bail d’habitation', "Bail d'habitation"]),
  homeInsurance: subject('home-insurance', 'contract', 'Assurance habitation Corbelin', [CONTRACTS.homeInsurance], ['Assurance habitation']),
  carInsurance: subject('car-insurance', 'contract', 'Assurance automobile Roulavie', [CONTRACTS.carInsurance2023, CONTRACTS.carInsurance2025], ['Assurance auto']),
  energyVoltaneige: subject('energy-contract-voltaneige', 'contract', "Contrat d'électricité Voltaneige", [CONTRACTS.voltaneige]),
  energyBrisevent: subject('energy-contract-brisevent', 'contract', "Contrat d'électricité Brisevent", [CONTRACTS.brisevent]),
  mobilePlan: subject('mobile-plan', 'contract', 'Forfait mobile Telorca', [CONTRACTS.mobile, JANE.mobile], ['Forfait Horizon 60 Go']),
  internet: subject('internet-subscription', 'contract', 'Abonnement internet Fibrenoix', [CONTRACTS.internet]),
  employment: subject('employment', 'employment', 'Emploi chez Ostrelia Conseil', [JANE.employeeNumber, 'Ostrelia Conseil']),
  bankAccount: subject('bank-account', 'account', 'Compte courant Crédit Orbien', [IBAN_TAIL], ['Compte chèques']),
} as const satisfies Readonly<Record<string, SubjectDefinition>>;

export const entityTruths = (): readonly EntityTruth[] =>
  Object.values(PARTIES).map(({ key, kind, canonical_name, aliases, identifiers }) => ({
    key,
    kind,
    canonical_name,
    aliases,
    identifiers,
  }));
