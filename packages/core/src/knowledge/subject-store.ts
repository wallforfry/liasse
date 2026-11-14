import { and, asc, cosineDistance, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';
import { subjects } from '../db/schema/knowledge.ts';
import type { SubjectKind } from '../domain/enums.ts';
import type { EntityReader, EntityTransaction } from '../entities/entity-store.ts';
import type { Embedding } from '../models/ports.ts';
import {
  parseSubjectIdentifiers,
  type SubjectIdentifier,
  toSubjectIdentifiersColumn,
} from './subject-identifiers.ts';

// Subjects are written in the transactions entities are written in: see `subject-lock.ts`.
export type SubjectTransaction = EntityTransaction;
export type SubjectReader = EntityReader;

export interface Subject {
  readonly id: string;
  readonly kind: SubjectKind;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly identifiers: readonly SubjectIdentifier[];
  // Only private documents have named it.
  readonly private: boolean;
}

// The embedding is left out: no reader of a subject needs its few hundred numbers.
const SUBJECT_COLUMNS = {
  id: subjects.id,
  kind: subjects.kind,
  canonicalName: subjects.canonicalName,
  aliases: subjects.aliases,
  identifiers: subjects.identifiers,
  private: subjects.private,
} as const;

interface SubjectRow extends Omit<Subject, 'identifiers'> {
  readonly identifiers: unknown;
}

const toSubject = ({ identifiers, ...row }: SubjectRow): Subject => ({
  ...row,
  identifiers: parseSubjectIdentifiers(identifiers),
});

const ofKind = (kind: SubjectKind | undefined) =>
  kind === undefined ? undefined : eq(subjects.kind, kind);

// Oldest first: ids sort by creation time, which makes every "first match" deterministic.
export const loadSubjects = async (
  reader: SubjectReader,
  kind?: SubjectKind,
): Promise<readonly Subject[]> =>
  (
    await reader
      .select(SUBJECT_COLUMNS)
      .from(subjects)
      .where(ofKind(kind))
      .orderBy(asc(subjects.id))
  ).map(toSubject);

export const findSubjectById = async (
  reader: SubjectReader,
  id: string,
): Promise<Subject | undefined> => {
  const [row] = await reader.select(SUBJECT_COLUMNS).from(subjects).where(eq(subjects.id, id));
  return row === undefined ? undefined : toSubject(row);
};

export const findSubjectsByIds = async (
  reader: SubjectReader,
  ids: readonly string[],
): Promise<readonly Subject[]> =>
  ids.length === 0
    ? []
    : (
        await reader
          .select(SUBJECT_COLUMNS)
          .from(subjects)
          .where(inArray(subjects.id, [...ids]))
          .orderBy(asc(subjects.id))
      ).map(toSubject);

// The ids among those given that no subject has, or no longer has after a merge. A writer
// of subject ids checks them with this under the subject lock, and resolves the subject of
// a missing id again once its own transaction has ended.
export const missingSubjectIds = async (
  reader: SubjectReader,
  ids: readonly string[],
): Promise<readonly string[]> => {
  const known = new Set((await findSubjectsByIds(reader, ids)).map(({ id }) => id));
  return ids.filter((id) => !known.has(id));
};

export interface SimilarSubject {
  readonly subject: Subject;
  // Cosine similarity between the given embedding and the one of the subject.
  readonly similarity: number;
}

// Every subject of the kind at least that similar, closest first.
export const similarSubjects = async (
  reader: SubjectReader,
  embedding: Embedding,
  kind: SubjectKind,
  minSimilarity: number,
): Promise<readonly SimilarSubject[]> => {
  const distance = cosineDistance(subjects.embedding, [...embedding]);
  const rows = await reader
    .select({ ...SUBJECT_COLUMNS, distance })
    .from(subjects)
    .where(
      and(isNotNull(subjects.embedding), ofKind(kind), sql`${distance} <= ${1 - minSimilarity}`),
    )
    .orderBy(asc(distance), asc(subjects.id));
  return rows.map(({ distance: gap, ...row }) => ({
    subject: toSubject(row),
    similarity: 1 - Number(gap),
  }));
};

export interface NewSubject {
  readonly kind: SubjectKind;
  readonly canonicalName: string;
  readonly identifiers: readonly SubjectIdentifier[];
  readonly embedding: Embedding | undefined;
  readonly private: boolean;
}

const written = (rows: readonly SubjectRow[]): Subject => {
  const [row] = rows;
  if (row === undefined) throw new Error('The subject row was not written');
  return toSubject(row);
};

export const insertSubject = async (
  tx: SubjectTransaction,
  { identifiers, embedding, ...values }: NewSubject,
): Promise<Subject> =>
  written(
    await tx
      .insert(subjects)
      .values({
        ...values,
        identifiers: toSubjectIdentifiersColumn(identifiers),
        ...(embedding === undefined ? {} : { embedding }),
      })
      .returning(SUBJECT_COLUMNS),
  );

export interface SubjectNames {
  readonly aliases: readonly string[];
  readonly identifiers: readonly SubjectIdentifier[];
}

export const updateSubjectNames = async (
  tx: SubjectTransaction,
  id: string,
  { aliases, identifiers }: SubjectNames,
): Promise<Subject> =>
  written(
    await tx
      .update(subjects)
      .set({ aliases, identifiers: toSubjectIdentifiersColumn(identifiers) })
      .where(eq(subjects.id, id))
      .returning(SUBJECT_COLUMNS),
  );

// Everything a subject is known by, replaced at once: when it stops being private, what
// only private documents said of it goes.
export interface SubjectIdentity extends SubjectNames {
  readonly canonicalName: string;
  readonly private: boolean;
}

export const replaceSubjectIdentity = async (
  tx: SubjectTransaction,
  id: string,
  { identifiers, ...identity }: SubjectIdentity,
  embedding: Embedding | undefined,
): Promise<Subject> =>
  written(
    await tx
      .update(subjects)
      .set({
        ...identity,
        identifiers: toSubjectIdentifiersColumn(identifiers),
        embedding: embedding ?? null,
      })
      .where(eq(subjects.id, id))
      .returning(SUBJECT_COLUMNS),
  );

// Whose embedding the target of a merge keeps: its own, the source's, or its own and,
// when it has none, the source's.
export type MergedEmbedding = 'target' | 'source' | 'either';

const absorbedEmbedding = (sourceId: string) =>
  sql`(SELECT absorbed.embedding FROM ${subjects} AS absorbed WHERE absorbed.id = ${sourceId})`;

const EMBEDDINGS: Readonly<Record<MergedEmbedding, (sourceId: string) => SQL>> = {
  target: () => sql`${subjects.embedding}`,
  source: absorbedEmbedding,
  either: (sourceId) => sql`COALESCE(${subjects.embedding}, ${absorbedEmbedding(sourceId)})`,
};

// The target takes the identity given and the embedding chosen; the source row is then
// deleted. References to the source are the caller's to rewrite.
export const absorbSubject = async (
  tx: SubjectTransaction,
  sourceId: string,
  targetId: string,
  { identifiers, ...identity }: SubjectIdentity,
  embedding: MergedEmbedding,
): Promise<Subject> => {
  const merged = written(
    await tx
      .update(subjects)
      .set({
        ...identity,
        identifiers: toSubjectIdentifiersColumn(identifiers),
        embedding: EMBEDDINGS[embedding](sourceId),
      })
      .where(eq(subjects.id, targetId))
      .returning(SUBJECT_COLUMNS),
  );
  await tx.delete(subjects).where(eq(subjects.id, sourceId));
  return merged;
};
