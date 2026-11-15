import type { DocumentStatus } from '@liasse/contract/domain';
import type { Database } from '../db/client.ts';
import { documentPages } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { EntityProvenance } from '../domain/provenance.ts';
import type { Embedder } from '../models/ports.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { indexDocument } from './indexing.ts';

// Everything here is invented: companies, people, amounts and references.
export const ENTITIES = {
  volta: 'ent_synthetic_volta',
  northwind: 'ent_synthetic_northwind',
  mutuelle: 'ent_synthetic_mutuelle',
  harbor: 'ent_synthetic_harbor',
  resident: 'ent_synthetic_resident',
} as const;

export type EntityId = (typeof ENTITIES)[keyof typeof ENTITIES];

export const ENTITY_NAMES: Readonly<Record<EntityId, string>> = {
  [ENTITIES.volta]: 'Volta Énergie',
  [ENTITIES.northwind]: 'Northwind Robotics',
  [ENTITIES.mutuelle]: 'Mutuelle des Collines',
  [ENTITIES.harbor]: 'Harbor Homes',
  [ENTITIES.resident]: 'Camille Tisserand',
};

const resolvedTo = (entityId: EntityId): EntityProvenance => ({
  entity_id: entityId,
  match: 'alias',
  confidence: 0.99,
});

export const SUBJECTS = {
  home: 'sub_synthetic_home',
  car: 'sub_synthetic_car',
} as const;

export interface CorpusDocument {
  readonly key: string;
  readonly title: string;
  readonly type: string;
  readonly language: string | null;
  readonly pages: readonly string[];
  readonly date?: string;
  readonly issuer?: EntityId;
  readonly recipient?: EntityId;
  readonly subjects?: readonly string[];
  readonly private?: boolean;
  readonly status?: DocumentStatus;
}

const TYPES = [
  {
    slug: 'energy_bill',
    description: 'Bill from an electricity or gas supplier',
    aliases: ['electricity_bill', 'legacy_power_bill'],
  },
  { slug: 'legacy_power_bill', description: 'Merged into energy_bill', status: 'merged' },
  { slug: 'payslip', description: 'Monthly payslip' },
  { slug: 'insurance_letter', description: 'Letter from an insurer' },
  { slug: 'rent_receipt', description: 'Receipt for a rent payment' },
  { slug: 'property_tax_notice', description: 'Property tax notice' },
  { slug: 'warranty', description: 'Warranty certificate' },
] as const;

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const twoDigits = (value: number): string => String(value).padStart(2, '0');

// The last two bills are still attached to the merged type.
const energyBills: readonly CorpusDocument[] = MOIS.map((mois, index) => ({
  key: `energy-${twoDigits(index + 1)}`,
  title: `Facture d’électricité ${mois} 2026`,
  type: index < 10 ? 'energy_bill' : 'legacy_power_bill',
  language: 'fr',
  pages: [
    `Facture d’électricité de ${mois} 2026. Fournisseur : Volta Énergie. ` +
      `Consommation relevée : ${String(300 + index * 7)} kWh. ` +
      `Montant total TTC : ${String(60 + index)},20 EUR, à régler sous quinze jours.`,
  ],
  date: `2026-${twoDigits(index + 1)}-05`,
  issuer: ENTITIES.volta,
  recipient: ENTITIES.resident,
  subjects: [SUBJECTS.home],
}));

const payslips: readonly CorpusDocument[] = MONTHS.map((month, index) => ({
  key: `payslip-${twoDigits(index + 1)}`,
  title: `Payslip ${month} 2026`,
  type: 'payslip',
  language: 'en',
  pages: [
    `Payslip for ${month} 2026. Employer: Northwind Robotics. Gross salary 4200.00 EUR, ` +
      `net salary ${String(3270 + index)}.00 EUR after social contributions.`,
  ],
  date: `2026-${twoDigits(index + 1)}-28`,
  issuer: ENTITIES.northwind,
  recipient: ENTITIES.resident,
}));

const INSURANCE_LETTERS = [
  ['Avis d’échéance', 'La cotisation annuelle de votre assurance habitation s’élève à 312 EUR.'],
  [
    'Attestation',
    'Nous attestons que le logement est assuré contre l’incendie et le dégât des eaux.',
  ],
  [
    'Conditions de résiliation',
    'Le contrat peut être résilié à chaque échéance annuelle avec un préavis de deux mois.',
  ],
  ['Garantie décennale', 'La garantie décennale couvre les travaux de toiture pendant dix ans.'],
  [
    'Déclaration de sinistre',
    'Votre déclaration de sinistre a bien été enregistrée par nos services.',
  ],
  [
    'Relevé d’information',
    'Aucun sinistre responsable n’a été déclaré sur les cinq dernières années.',
  ],
  ['Carte verte', 'Votre véhicule est assuré au tiers pour l’année en cours.'],
  ['Avenant', 'Cet avenant modifie le conducteur principal du véhicule assuré.'],
] as const;

const insuranceLetters: readonly CorpusDocument[] = INSURANCE_LETTERS.map(
  ([topic, body], index) => ({
    key: `insurance-${twoDigits(index + 1)}`,
    title: `Mutuelle des Collines - ${topic}`,
    type: 'insurance_letter',
    language: 'fr',
    pages: [`${topic}. ${body} Mutuelle des Collines, service des contrats.`],
    date: `2025-${twoDigits(index + 1)}-12`,
    issuer: ENTITIES.mutuelle,
    subjects: [index < 6 ? SUBJECTS.home : SUBJECTS.car],
  }),
);

const rentReceipts: readonly CorpusDocument[] = MONTHS.slice(0, 10).map((month, index) => ({
  key: `rent-${twoDigits(index + 1)}`,
  title: `Rent receipt ${month} 2026`,
  type: 'rent_receipt',
  language: 'en',
  pages: [
    `Rent receipt for ${month} 2026. Received from the tenant the sum of 950.00 EUR ` +
      'for the apartment on Maple Street. Landlord: Harbor Homes.',
  ],
  date: `2026-${twoDigits(index + 1)}-01`,
  issuer: ENTITIES.harbor,
  recipient: ENTITIES.resident,
  subjects: [SUBJECTS.home],
}));

const taxNotices: readonly CorpusDocument[] = [2022, 2023, 2024, 2025].map((year, index) => ({
  key: `tax-${String(year)}`,
  title: `Avis de taxe foncière ${String(year)}`,
  type: 'property_tax_notice',
  language: 'fr',
  pages: [
    `Avis de taxe foncière ${String(year)} pour la résidence principale. ` +
      `Montant à payer : ${String(1100 + index * 28)} EUR avant le 15 octobre.`,
  ],
  date: `${String(year)}-09-01`,
  subjects: [SUBJECTS.home],
  private: index >= 2,
}));

const APPLIANCES = ['Aquaflow', 'Brisa', 'Cendre', 'Dorado', 'Estival', 'Fjord'];

const warranties: readonly CorpusDocument[] = APPLIANCES.map((model, index) => ({
  key: `warranty-${twoDigits(index + 1)}`,
  title: `Warranty certificate ${model}`,
  type: 'warranty',
  language: null,
  pages: [
    `Warranty certificate reference ZX${String(4100 + index)}. Appliance model ${model}, ` +
      'covered for 24 months from the purchase.',
  ],
  status: index < 2 ? 'needs_review' : 'indexed',
}));

export const CORPUS: readonly CorpusDocument[] = [
  ...energyBills,
  ...payslips,
  ...insuranceLetters,
  ...rentReceipts,
  ...taxNotices,
  ...warranties,
];

export interface SeededCorpus {
  readonly idOf: (key: string) => string;
  readonly keyOf: (id: string) => string;
  readonly add: (document: CorpusDocument, embedder?: Embedder) => Promise<string>;
}

export const seedCorpus = async (db: Database, embedder: Embedder): Promise<SeededCorpus> => {
  const types = await db
    .insert(docTypes)
    .values(TYPES.map((type) => ({ ...type, aliases: 'aliases' in type ? type.aliases : [] })))
    .returning({ id: docTypes.id, slug: docTypes.slug });
  const typeIds = new Map(types.map((type) => [type.slug, type.id]));
  const ids = new Map<string, string>();
  const keys = new Map<string, string>();

  const add: SeededCorpus['add'] = async (document, indexWith = embedder) => {
    const { id } = await insertSyntheticDocument(db, {
      title: document.title,
      typeId: typeIds.get(document.type) ?? null,
      status: document.status ?? 'indexed',
      private: document.private ?? false,
      subjectIds: document.subjects ?? [],
      core: {
        ...(document.language === null ? {} : { language: document.language }),
        ...(document.date === undefined ? {} : { document_date: document.date }),
        ...(document.issuer === undefined ? {} : { issuer: ENTITY_NAMES[document.issuer] }),
        ...(document.recipient === undefined
          ? {}
          : { recipient: ENTITY_NAMES[document.recipient] }),
      },
      provenance: {
        ...(document.issuer === undefined ? {} : { issuer: resolvedTo(document.issuer) }),
        ...(document.recipient === undefined ? {} : { recipient: resolvedTo(document.recipient) }),
      },
    });
    await db
      .insert(documentPages)
      .values(document.pages.map((text, index) => ({ documentId: id, page: index + 1, text })));
    await indexDocument({ db, embedder: indexWith }, id);
    ids.set(document.key, id);
    keys.set(id, document.key);
    return id;
  };

  for (const document of CORPUS) await add(document);

  const lookup = (map: ReadonlyMap<string, string>, name: string): string => {
    const found = map.get(name);
    if (found === undefined) throw new Error(`The corpus has no document ${name}`);
    return found;
  };
  return {
    idOf: (key) => lookup(ids, key),
    keyOf: (id) => lookup(keys, id),
    add,
  };
};
