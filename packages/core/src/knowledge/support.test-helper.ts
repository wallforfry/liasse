import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documentDates, documentLinks, facts, subjects } from '../db/schema/knowledge.ts';
import { documents } from '../db/schema/documents.ts';
import type { LinkKind, SubjectKind } from '../domain/enums.ts';
import { TEST_IDENTIFIER_KEY } from '../entities/support.test-helper.ts';
import type { Embedding } from '../models/ports.ts';
import type { KnowledgeFact, KnowledgeInput, KnowledgeKeyDate, KnowledgeSubject } from './input.ts';
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
  readonly embedding?: Embedding;
}

export const seedSubject = async (
  db: Database,
  { kind, name, aliases = [], identifier, embedding }: SeededSubject,
): Promise<string> => {
  const [row] = await db
    .insert(subjects)
    .values({
      kind,
      canonicalName: name,
      aliases,
      identifiers: toSubjectIdentifiersColumn(
        storeSubjectIdentifier(TEST_IDENTIFIER_KEY, kind, identifier),
      ),
      ...(embedding === undefined ? {} : { embedding }),
    })
    .returning({ id: subjects.id });
  if (row === undefined) throw new Error('The subject was not seeded');
  return row.id;
};

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
