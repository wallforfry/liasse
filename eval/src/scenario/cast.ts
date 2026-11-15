import type { EntityKind } from '@liasse/contract/domain';
import {
  frenchIban,
  seededDigits,
  siren,
  siret,
  socialSecurityNumber,
  taxNumber,
  TEST_CARD_NUMBER,
} from '../identifiers.ts';
import type { EntityTruth, SubjectDefinition } from '../schema/index.ts';

// Everyone and everything here is invented. The names of companies, brands, towns and
// the river are coinages, each searched on the web before it was adopted (the README
// lists them). Postcodes start with 99 (France) or 00 (Germany, Spain), or use the
// outward code ZZ (United Kingdom). Phone numbers are in the ranges the French and
// British regulators reserve for fiction; e-mail and web addresses are on reserved domains.

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

export const HOME_ADDRESS = '4 allée des Hirondelles, 99120 Trévolzac-sur-Yvrelle';
const TOWN = '99120 Trévolzac-sur-Yvrelle';

// prettier-ignore
export const PARTIES = {
  jane: party('jane-doe', 'person', 'Jane Doe', 'Jane Doe', HOME_ADDRESS, ['Mme Jane Doe', 'Madame Jane Doe', 'Ms Jane Doe', 'Doe Jane']),
  malo: party('malo-kerven', 'person', 'Malo Kerven', 'Malo Kerven', HOME_ADDRESS, ['M. Malo Kerven']),
  voltaneige: party('voltaneige', 'org', 'Voltaneige Energie', 'VOLTANEIGE ENERGIE SAS', `18 quai des Verriers, ${TOWN}`, ['Voltaneige'], 'voltaneige'),
  brisevent: party('brisevent', 'org', 'Brisevent Électricité', 'BRISEVENT ÉLECTRICITÉ SA', '3 place du Moulin-Neuf, 99300 Port-Lanvec', ['Brisevent'], 'brisevent'),
  telorca: party('telorca', 'org', 'Telorca', 'TELORCA SAS', '27 avenue des Câbliers, 99410 Sainte-Orme', ['Telorca Mobile'], 'telorca'),
  fibrenoix: party('fibrenoix', 'org', 'Fibrenoix', 'FIBRENOIX SAS', `5 rue du Noyer, ${TOWN}`, [], 'fibrenoix'),
  waterBoard: party('regie-des-eaux', 'org', "Régie des Eaux de l'Yvrelle", "RÉGIE DES EAUX DE L'YVRELLE", `1 chemin du Captage, ${TOWN}`, ['Régie des Eaux']),
  tolverane: party('tolverane', 'org', 'Assurances Tolvérane', 'ASSURANCES TOLVÉRANE SA', '40 boulevard des Tisserands, 99200 Quivrenne-la-Forêt', ['Tolvérane', 'Tolvérane Assurances'], 'tolverane'),
  roulavie: party('roulavie', 'org', 'Roulavie Assurances', 'ROULAVIE ASSURANCES SA', '11 rue des Charrons, 99300 Port-Lanvec', ['Roulavie'], 'roulavie'),
  agency: party('agence-vouzelin', 'org', 'Agence Immobilière Vouzelin', 'AGENCE IMMOBILIÈRE VOUZELIN SARL', `2 place du Marché, ${TOWN}`, ['Agence Vouzelin'], 'agency'),
  landlord: party('hector-vasseur', 'person', 'Hector Vasseur', 'Hector Vasseur', '31 route des Crêtes, 99150 Montbrisac', ['M. Hector Vasseur']),
  employer: party('ostrelia', 'org', 'Ostrelia Conseil', 'OSTRELIA CONSEIL SAS', '8 rue des Imprimeurs, 99300 Port-Lanvec', ['Ostrelia'], 'ostrelia'),
  bank: party('credit-yvrellois', 'org', 'Crédit Yvrellois', 'CRÉDIT YVRELLOIS', `14 cours des Halles, ${TOWN}`, ['Credit Yvrellois'], 'credit-yvrellois'),
  taxOffice: party('centre-des-finances-publiques', 'org', 'Centre des Finances Publiques de Trévolzac-sur-Yvrelle', 'CENTRE DES FINANCES PUBLIQUES DE TRÉVOLZAC-SUR-YVRELLE', `6 rue de la Trésorerie, ${TOWN}`, ['Service des impôts des particuliers de Trévolzac-sur-Yvrelle']),
  finesAgency: party('agence-des-contraventions', 'org', "Agence de Traitement des Contraventions de l'Yvrelle", "AGENCE DE TRAITEMENT DES CONTRAVENTIONS DE L'YVRELLE", 'CS 40017, 99309 Port-Lanvec Cedex', ["Agence de Traitement des Contraventions"]),
  garage: party('garage-brumezac', 'org', 'Garage Brumezac', 'GARAGE BRUMEZAC SARL', `21 route de Montbrisac, ${TOWN}`, [], 'garage'),
  inspection: party('zerubane-controle', 'org', 'Zérubane Contrôle', 'ZÉRUBANE CONTRÔLE', `ZA des Gravières, ${TOWN}`, [], 'zerubane'),
  lab: party('laboratoire-zolmea', 'org', 'Laboratoire Zolméa', 'LABORATOIRE ZOLMÉA', `9 allée des Hirondelles, ${TOWN}`),
  mutual: party('mutuelle-ozvalie-sante', 'org', 'Mutuelle Ozvalie Santé', 'MUTUELLE OZVALIE SANTÉ', '55 rue des Drapiers, 99200 Quivrenne-la-Forêt', ['Ozvalie Santé']),
  bikeShop: party('brindlemoor-cycles', 'org', 'Brindlemoor Cycles', 'Brindlemoor Cycles Ltd', '7 Tannery Row, Brindlemoor, ZZ4 9QX, United Kingdom'),
  cloud: party('quillfern-cloud', 'org', 'Quillfern Cloud', 'Quillfern Cloud Inc.', '900 Example Parkway, Suite 12, Fernhollow, ZZ 00042, USA', ['Quillfern']),
  travelInsurer: party('northmere-travel-cover', 'org', 'Northmere Travel Cover', 'Northmere Travel Cover Ltd', '2 Quay Street, Northmere, ZZ1 4NM, United Kingdom', ['Northmere']),
  hotel: party('gasthof-lindenhoehe', 'org', 'Gasthof Lindenhöhe', 'Gasthof Lindenhöhe', 'Seeuferweg 3, 00917 Tannwald am See', ['Gasthof Lindenhoehe']),
  carRental: party('alquileres-zubrenal', 'org', 'Alquileres Zubrenal', 'Alquileres Zubrenal S.L.', 'Avenida del Faro 18, 00420 Puerto Zubrenal', ['Zubrenal']),
  furniture: party('meubles-sauvageon', 'org', 'Meubles Sauvageon', 'MEUBLES SAUVAGEON', `33 rue du Lavoir, ${TOWN}`, ['Sauvageon']),
  hardware: party('brico-yvrelle', 'org', 'Brico Yvrelle', 'BRICO YVRELLE', `ZA des Gravières, ${TOWN}`),
  parking: party('parking-halle-yvrelle', 'org', 'Parking Halle Yvrelle', 'PARKING HALLE YVRELLE', `Place du Marché, ${TOWN}`),
} as const satisfies Readonly<Record<string, Party>>;

export const OWNER = PARTIES.jane.key;

export const companyLine = (label: keyof typeof PARTIES): string => {
  const company = PARTIES[label].identifiers[0]?.value;
  return company === undefined ? '' : `SIREN ${company}`;
};

// Identifiers of the household. None can designate anything real: see
// `identifiers.ts` for how they are built.
export const JANE = {
  email: 'jane.doe@example.org',
  mobile: '06 39 98 01 23',
  iban: frenchIban('jane'),
  card: (TEST_CARD_NUMBER.match(/.{4}/g) ?? []).join(' '),
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
  home: subject('home', 'property', 'Appartement du 4 allée des Hirondelles, Trévolzac-sur-Yvrelle', ['4 allée des Hirondelles', METER_ID], ['Logement de Trévolzac-sur-Yvrelle']),
  car: subject('car', 'vehicle', `${CAR.model} ${CAR.plate}`, [CAR.plate, CAR.vin], ['Velanta Coriol']),
  lease: subject('lease', 'contract', 'Bail du 4 allée des Hirondelles', [CONTRACTS.lease], ['Bail d’habitation', "Bail d'habitation"]),
  homeInsurance: subject('home-insurance', 'contract', 'Assurance habitation Tolvérane', [CONTRACTS.homeInsurance], ['Assurance habitation']),
  carInsurance: subject('car-insurance', 'contract', 'Assurance automobile Roulavie', [CONTRACTS.carInsurance2023, CONTRACTS.carInsurance2025], ['Assurance auto']),
  energyVoltaneige: subject('energy-contract-voltaneige', 'contract', "Contrat d'électricité Voltaneige", [CONTRACTS.voltaneige]),
  energyBrisevent: subject('energy-contract-brisevent', 'contract', "Contrat d'électricité Brisevent", [CONTRACTS.brisevent]),
  mobilePlan: subject('mobile-plan', 'contract', 'Forfait mobile Telorca', [CONTRACTS.mobile, JANE.mobile], ['Forfait Horizon 60 Go']),
  internet: subject('internet-subscription', 'contract', 'Abonnement internet Fibrenoix', [CONTRACTS.internet]),
  employment: subject('employment', 'employment', 'Emploi chez Ostrelia Conseil', [JANE.employeeNumber, 'Ostrelia Conseil']),
  bankAccount: subject('bank-account', 'account', 'Compte courant Crédit Yvrellois', [IBAN_TAIL], ['Compte chèques']),
} as const satisfies Readonly<Record<string, SubjectDefinition>>;

export const entityTruths = (): readonly EntityTruth[] =>
  Object.values(PARTIES).map(({ key, kind, canonical_name, aliases, identifiers }) => ({
    key,
    kind,
    canonical_name,
    aliases,
    identifiers,
  }));
