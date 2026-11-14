import type { Database } from '../db/client.ts';
import { docTypes } from '../db/schema/registry.ts';
import { seedEntity, TEST_IDENTIFIER_KEY } from '../entities/support.test-helper.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { insertSyntheticDocument, type NewDocumentRow } from '../testing/fixtures.ts';
import { detectLinks } from './detect-links.ts';
import type { KnowledgeInput } from './input.ts';
import type { ProposedLink } from './link-prompt.ts';
import { persistKnowledge } from './persist-knowledge.ts';
import { prepareKnowledge } from './prepare-knowledge.ts';
import { candidate, documentRow, fact, keyDate, knowledge } from './support.test-helper.ts';

// A small household, entirely made up: a home insurance that renews every March 1st with
// a two-month notice, its amendment, the letter that ends it, the contract that replaces
// it, a change of energy supplier, a bill and its payment, a car, and one private letter.

const HOME = candidate('property', 'Lyon apartment', '12 rue des Lilas, 69003 Lyon');
const OLD_CONTRACT = candidate('contract', 'Home insurance contract', 'HAB-2025-00417');
const NEW_CONTRACT = candidate('contract', 'Home insurance contract', 'MC-88-204571');
const CAR = candidate('vehicle', 'Renault Clio', 'AB-123-CD');

export type Scenario = Awaited<ReturnType<typeof buildScenario>>;

export const buildScenario = async (db: Database) => {
  const embedder = createFakeEmbedder();
  const context = {
    db,
    embedder,
    textModel: createFakeTextModel([]),
    identifierKey: TEST_IDENTIFIER_KEY,
  };

  const [insuranceType, billType, mergedBillType] = await db
    .insert(docTypes)
    .values([
      { slug: 'insurance_contract', description: 'An insurance contract' },
      { slug: 'energy_bill', description: 'An energy bill', aliases: ['power_bill', 'volta_bill'] },
      { slug: 'volta_bill', description: 'A bill of one supplier', status: 'merged' },
    ])
    .returning({ id: docTypes.id });

  const mirabelle = await seedEntity(db, { name: 'Assurances Mirabelle' });
  const cassis = await seedEntity(db, { name: 'Mutuelle Cassis' });
  const volta = await seedEntity(db, { name: 'Volta Energie' });
  const lumen = await seedEntity(db, { name: 'Lumen Power' });
  const holder = await seedEntity(db, { name: 'Camille Synthetic', kind: 'person' });

  const issuedBy = (entityId: string) => ({
    issuer: { entity_id: entityId, match: 'name', confidence: 0.99 },
  });

  const add = async (
    title: string,
    date: string,
    issuer: string,
    input: KnowledgeInput,
    overrides: Partial<NewDocumentRow> = {},
  ): Promise<string> => {
    const { core, ...rest } = overrides;
    const document = await insertSyntheticDocument(db, {
      title,
      summary: `${title}, a synthetic document.`,
      status: 'indexed',
      provenance: issuedBy(issuer),
      core: { document_date: date, language: 'en', ...core },
      ...rest,
    });
    const about = { id: document.id, private: document.private };
    const prepared = await prepareKnowledge(context, about, input);
    await db.transaction((tx) => persistKnowledge(tx, about, prepared));
    return document.id;
  };

  const link = async (
    documentId: string,
    links: readonly Omit<ProposedLink, 'confidence' | 'rationale'>[],
  ) => {
    const textModel = createFakeTextModel([
      {
        links: links.map((proposed) => ({ ...proposed, confidence: 0.9, rationale: 'Synthetic.' })),
      },
    ]);
    await detectLinks({ db, textModel }, documentId);
  };

  const contract = await add(
    'Home insurance contract 2025',
    '2025-03-01',
    mirabelle,
    knowledge({
      keyDates: [
        keyDate('effective', '2025-03-01', 'Start of cover'),
        keyDate('renewal', '2026-03-01', 'Automatic renewal'),
        keyDate('notice_deadline', '2026-02-15', 'Deadline guessed by the model'),
      ],
      facts: [
        fact(
          'The Assurances Mirabelle home insurance for the Lyon apartment renews automatically every March 1st, with a two-month notice period.',
          {
            validFrom: '2025-03-01',
            entityIds: [mirabelle],
            subjects: ['Home insurance contract', 'Lyon apartment'],
          },
        ),
      ],
      subjects: [OLD_CONTRACT, HOME],
      noticePeriod: { amount: 2, unit: 'months', confidence: 0.95 },
    }),
    { typeId: insuranceType?.id, core: { reference: 'HAB-2025-00417' } },
  );

  const amendment = await add(
    'Amendment adding the cellar',
    '2025-09-01',
    mirabelle,
    knowledge({
      keyDates: [keyDate('expiry', '2026-02-10', 'End of the cellar option')],
      facts: [
        fact('The cellar of the Lyon apartment is covered from September 15th 2025.', {
          validFrom: '2025-09-15',
          entityIds: [mirabelle],
          subjects: ['Home insurance contract'],
        }),
      ],
      subjects: [OLD_CONTRACT],
    }),
    { typeId: insuranceType?.id, core: { reference: 'HAB-2025-00417' } },
  );

  const termination = await add(
    'Letter terminating the home insurance',
    '2025-12-10',
    holder,
    knowledge({
      keyDates: [keyDate('effective', '2026-02-28', 'Last day of cover')],
      facts: [
        fact(
          'Camille Synthetic terminated the Assurances Mirabelle home insurance, effective February 28th 2026.',
          {
            validFrom: '2025-12-10',
            entityIds: [holder, mirabelle],
            subjects: ['Home insurance contract'],
          },
        ),
      ],
      subjects: [OLD_CONTRACT],
    }),
  );

  const newContract = await add(
    'Home insurance contract 2026',
    '2026-02-20',
    cassis,
    knowledge({
      keyDates: [
        keyDate('effective', '2026-03-01', 'Start of cover'),
        keyDate('renewal', '2027-03-01', 'Automatic renewal'),
      ],
      facts: [
        fact('Mutuelle Cassis insures the Lyon apartment from March 1st 2026.', {
          validFrom: '2026-03-01',
          entityIds: [cassis],
          subjects: ['Home insurance contract', 'Lyon apartment'],
        }),
      ],
      subjects: [NEW_CONTRACT, HOME],
      noticePeriod: { amount: 1, unit: 'months', confidence: 0.9 },
    }),
    { typeId: insuranceType?.id, core: { reference: 'MC-88-204571' } },
  );

  const bill = await add(
    'Volta Energie bill of November 2025',
    '2025-11-05',
    volta,
    knowledge({
      keyDates: [keyDate('due', '2025-11-20', 'Payment due')],
      facts: [
        fact('Volta Energie supplies electricity to the Lyon apartment.', {
          validFrom: '2024-01-01',
          validTo: '2026-01-31',
          entityIds: [volta],
          subjects: ['Lyon apartment'],
        }),
      ],
      subjects: [HOME],
    }),
    {
      typeId: mergedBillType?.id,
      core: { reference: 'FAC-2025-1105', amount: { value: 84.2, currency: 'EUR' } },
    },
  );

  const payment = await add(
    'Payment confirmation FAC-2025-1105',
    '2025-11-18',
    holder,
    knowledge({
      facts: [
        fact('The Volta Energie bill of November 2025 was paid on November 18th 2025.', {
          validFrom: '2025-11-18',
          entityIds: [volta],
        }),
      ],
    }),
    { core: { reference: 'FAC 2025 1105', amount: { value: 84.2, currency: 'EUR' } } },
  );

  const switchLetter = await add(
    'Welcome letter of Lumen Power',
    '2026-01-20',
    lumen,
    knowledge({
      keyDates: [keyDate('effective', '2026-02-01', 'Start of supply')],
      facts: [
        fact(
          'The electricity supplier of the Lyon apartment switched from Volta Energie to Lumen Power on February 1st 2026.',
          {
            validFrom: '2026-02-01',
            entityIds: [lumen, volta],
            subjects: ['Lyon apartment'],
          },
        ),
      ],
      subjects: [HOME],
    }),
    { typeId: billType?.id },
  );

  const registration = await add(
    'Registration certificate of the Clio',
    '2024-06-12',
    holder,
    knowledge({
      facts: [
        fact('The Renault Clio registered AB-123-CD was first registered on June 12th 2024.', {
          validFrom: '2024-06-12',
          subjects: ['Renault Clio'],
        }),
      ],
      subjects: [CAR],
    }),
  );

  const carInsurance = await add(
    'Car insurance certificate',
    '2025-03-20',
    mirabelle,
    knowledge({
      keyDates: [keyDate('expiry', '2026-03-15', 'End of validity of the certificate')],
      facts: [
        fact('Assurances Mirabelle insures the Renault Clio until March 15th 2026.', {
          validFrom: '2025-03-16',
          validTo: '2026-03-15',
          entityIds: [mirabelle],
          subjects: ['renault clio'],
        }),
      ],
      subjects: [candidate('vehicle', 'The Clio', 'ab 123 cd')],
    }),
    { typeId: insuranceType?.id },
  );

  const privateLetter = await add(
    'Private letter about the car loan',
    '2026-01-05',
    holder,
    knowledge({
      keyDates: [keyDate('due', '2026-02-05', 'Private instalment')],
      facts: [
        fact('The loan for the Renault Clio is repaid by a private instalment every month.', {
          validFrom: '2026-01-05',
          subjects: ['Renault Clio'],
        }),
      ],
      subjects: [CAR, candidate('account', 'Private loan account', 'PL-000777')],
    }),
    { private: true },
  );

  const deleted = await add(
    'Deleted quote',
    '2026-01-07',
    mirabelle,
    knowledge({
      keyDates: [keyDate('expiry', '2026-02-07', 'End of the deleted quote')],
      facts: [
        fact('A deleted quote offered a cheaper home insurance.', { subjects: ['Lyon apartment'] }),
      ],
      subjects: [HOME],
    }),
  );
  await deleteDocument({ db }, deleted);

  await link(amendment, [{ candidate: contract, kind: 'amends', actor: 'document' }]);
  await link(termination, [{ candidate: contract, kind: 'terminates', actor: 'document' }]);
  await link(newContract, [{ candidate: contract, kind: 'supersedes', actor: 'document' }]);
  await link(payment, [{ candidate: bill, kind: 'pays', actor: 'document' }]);

  const subjectsOf = async (documentId: string) => (await documentRow(db, documentId)).subjectIds;
  const [oldContractSubject = '', home = ''] = await subjectsOf(contract);
  const [newContractSubject = ''] = await subjectsOf(newContract);
  const [car = ''] = await subjectsOf(registration);
  const [, privateAccount = ''] = await subjectsOf(privateLetter);

  return {
    embedder,
    documents: {
      contract,
      amendment,
      termination,
      newContract,
      bill,
      payment,
      switchLetter,
      registration,
      carInsurance,
      privateLetter,
      deleted,
    },
    entities: { mirabelle, cassis, volta, lumen, holder },
    subjects: { oldContractSubject, newContractSubject, home, car, privateAccount },
  };
};
