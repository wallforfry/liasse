import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documentDates, documentLinks, facts, subjects } from '../db/schema/knowledge.ts';
import { documents } from '../db/schema/documents.ts';
import type { LinkKind, SubjectKind } from '../domain/enums.ts';
import { TEST_IDENTIFIER_KEY } from '../entities/support.test-helper.ts';
import type { Embedding } from '../models/ports.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { detectLinks } from './detect-links.ts';
import type { KnowledgeFact, KnowledgeInput, KnowledgeKeyDate, KnowledgeSubject } from './input.ts';
import type { ProposedLink } from './link-prompt.ts';
import { createPersistKnowledge } from './persist-knowledge.ts';
import { storeSubjectIdentifier, toSubjectIdentifiersColumn } from './subject-identifiers.ts';

export const TRACE = {
  model: 'fake-text-model',
  schemaVersion: 2,
  page: 1,
  quote: 'synthetic quote',
  // A value the `real` column holds exactly, so that what is read back is what was written.
  confidence: 0.75,
} as const;

export const keyDate = (
  kind: KnowledgeKeyDate['kind'],
  date: string,
  label: string,
  overrides: Partial<KnowledgeKeyDate> = {},
): KnowledgeKeyDate => ({ kind, date, label, ...TRACE, ...overrides });

export const fact = (text: string, overrides: Partial<KnowledgeFact> = {}): KnowledgeFact => ({
  text,
  validFrom: null,
  validTo: null,
  entityIds: [],
  subjects: [],
  ...TRACE,
  ...overrides,
});

export const candidate = (
  kind: SubjectKind,
  name: string,
  identifier?: string,
): KnowledgeSubject => ({ kind, name, ...(identifier === undefined ? {} : { identifier }) });

export const knowledge = (parts: Partial<KnowledgeInput> = {}): KnowledgeInput => ({
  keyDates: [],
  facts: [],
  subjects: [],
  ...parts,
});

export interface SeededSubject {
  readonly kind: SubjectKind;
  readonly name: string;
  readonly aliases?: readonly string[];
  // As a document writes it: stored the way resolution stores it.
  readonly identifier?: string;
  // The entity that issued a contract, job or account number.
  readonly issuerId?: string;
  readonly embedding?: Embedding;
  readonly private?: boolean;
}

export const seedSubject = async (
  db: Database,
  { kind, name, aliases = [], identifier, issuerId, embedding, ...rest }: SeededSubject,
): Promise<string> => {
  const [row] = await db
    .insert(subjects)
    .values({
      kind,
      canonicalName: name,
      aliases,
      identifiers: toSubjectIdentifiersColumn(
        storeSubjectIdentifier(TEST_IDENTIFIER_KEY, kind, identifier, issuerId),
      ),
      private: rest.private ?? false,
      ...(embedding === undefined ? {} : { embedding }),
    })
    .returning({ id: subjects.id });
  if (row === undefined) throw new Error('The subject was not seeded');
  return row.id;
};

export interface AddedDocument {
  readonly title: string;
  readonly date: string;
  readonly issuerId?: string;
  readonly private?: boolean;
  readonly typeId?: string | undefined;
  readonly core?: Readonly<Record<string, unknown>>;
}

const persistWithoutModels = createPersistKnowledge({ identifierKey: TEST_IDENTIFIER_KEY });

// A document as the pipeline leaves it, with its knowledge stored by exact rules only.
export const addDocument = async (
  db: Database,
  { title, date, issuerId, typeId, core = {}, ...rest }: AddedDocument,
  input: KnowledgeInput = knowledge(),
): Promise<string> => {
  const isPrivate = rest.private ?? false;
  const document = await insertSyntheticDocument(db, {
    title,
    summary: `${title}, a synthetic document.`,
    status: 'indexed',
    private: isPrivate,
    typeId: typeId ?? null,
    provenance:
      issuerId === undefined
        ? {}
        : { issuer: { entity_id: issuerId, match: 'name', confidence: 0.99 } },
    core: { document_date: date, language: 'en', ...core },
  });
  await db.transaction((tx) =>
    persistWithoutModels(tx, { id: document.id, private: isPrivate }, input),
  );
  return document.id;
};

export type ScriptedLink = Omit<ProposedLink, 'confidence' | 'rationale'> & {
  readonly confidence?: number;
};

// One detection of the links of a document, the text model answering with these links.
export const detectWith = (db: Database, documentId: string, links: readonly ScriptedLink[]) =>
  detectLinks(
    {
      db,
      textModel: createFakeTextModel([
        { links: links.map((link) => ({ confidence: 0.9, rationale: 'Synthetic.', ...link })) },
      ]),
    },
    documentId,
  );

export const subjectRow = async (db: Database, id: string) => {
  const [row] = await db.select().from(subjects).where(eq(subjects.id, id));
  return row;
};

export const documentRow = async (db: Database, id: string) => {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  if (row === undefined) throw new Error(`The document ${id} is gone`);
  return row;
};

export const datesOf = (db: Database, documentId: string) =>
  db
    .select({
      kind: documentDates.kind,
      date: documentDates.date,
      label: documentDates.label,
      model: documentDates.model,
      quote: documentDates.quote,
      confidence: documentDates.confidence,
    })
    .from(documentDates)
    .where(eq(documentDates.documentId, documentId))
    .orderBy(documentDates.date, documentDates.kind);

export const factsOf = (db: Database, documentId: string) =>
  db.select().from(facts).where(eq(facts.documentId, documentId)).orderBy(facts.id);

export const linkBetween = async (
  db: Database,
  fromDocumentId: string,
  toDocumentId: string,
  kind: LinkKind,
): Promise<void> => {
  await db.insert(documentLinks).values({ fromDocumentId, toDocumentId, kind });
};

export const linksOf = async (db: Database): Promise<readonly string[]> =>
  (
    await db
      .select({
        from: documentLinks.fromDocumentId,
        to: documentLinks.toDocumentId,
        kind: documentLinks.kind,
      })
      .from(documentLinks)
  )
    .map(({ from, to, kind }) => `${from} ${kind} ${to}`)
    .toSorted();
