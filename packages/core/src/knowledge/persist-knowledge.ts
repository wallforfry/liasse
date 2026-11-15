import { languageCodeSchema } from '@liasse/contract/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { PROVENANCE_ENTITY_ID_KEY } from '../domain/provenance.ts';
import { missingEntityIds } from '../entities/entity-store.ts';
import type { IdentifierKey } from '../entities/sensitive.ts';
import { ENTITY_SIMILARITY, type SimilarityThresholds } from '../entities/similarity.ts';
import { type FactRow, replaceFacts } from './facts.ts';
import type { KnowledgeDocument, KnowledgeInput } from './input.ts';
import { replaceKeyDates } from './key-dates.ts';
import { type PreparedKnowledge, prepareWithoutModels } from './prepare-knowledge.ts';
import { resolveSubjectUnderLock } from './resolve-subject.ts';
import type { SubjectOrigin } from './subject-enrichment.ts';
import { subjectLabelKey } from './subject-label.ts';
import { blankOrphanSubjects } from './subject-orphans.ts';
import { withSubjectLock } from './subject-lock.ts';
import { findSubjectsByIds, type SubjectTransaction } from './subject-store.ts';

interface LockedDocument {
  readonly private: boolean;
  readonly language: string | null;
  // The entity that issued the document: the scope of the contract numbers it writes.
  readonly issuerId: string | undefined;
  // The subjects the document concerned before this extraction.
  readonly subjectIds: readonly string[];
}

const issuerIdSchema = z.object({ [PROVENANCE_ENTITY_ID_KEY]: z.string().min(1) });

// A tombstone gets nothing back: the row is read with the tombstone rule, and locked, so
// a deletion either committed before or waits for this transaction.
const lockDocument = async (
  tx: SubjectTransaction,
  documentId: string,
): Promise<LockedDocument | undefined> => {
  const [row] = await tx
    .select({
      private: documents.private,
      core: documents.core,
      provenance: documents.provenance,
      subjectIds: documents.subjectIds,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isLiveDocument))
    .for('update');
  return row === undefined
    ? undefined
    : {
        private: row.private,
        language: languageCodeSchema.safeParse(row.core.language).data ?? null,
        issuerId: issuerIdSchema.safeParse(row.provenance.issuer).data?.[PROVENANCE_ENTITY_ID_KEY],
        subjectIds: row.subjectIds,
      };
};

// What a provider outside the installation computed is not used for a document that is
// private by the time its row is locked: the flag was set while the knowledge was being
// prepared. The text was already sent, as for the chunks; nothing derived from it stays.
const withoutExternalEmbeddings = (
  prepared: PreparedKnowledge,
  document: LockedDocument,
): PreparedKnowledge =>
  document.private && prepared.embeddedExternally
    ? {
        ...prepared,
        factEmbeddings: undefined,
        subjects: prepared.subjects.map(({ mention }) => ({
          mention,
          embedding: undefined,
          verdict: undefined,
        })),
      }
    : prepared;

interface ResolvedSubjects {
  // In the order the document names them, each once.
  readonly ids: readonly string[];
  // The subjects of the document a label designates: the label a candidate was given,
  // and every label its subject goes by.
  readonly byLabelKey: ReadonlyMap<string, readonly string[]>;
}

// Each candidate is resolved under the lock, in order: a subject created for one is
// there for the next.
const resolveSubjects = async (
  tx: SubjectTransaction,
  { subjects, similarity }: Pick<PreparedKnowledge, 'subjects' | 'similarity'>,
  origin: SubjectOrigin,
): Promise<ResolvedSubjects> => {
  const labelled: (readonly [labelKey: string, subjectId: string])[] = [];
  for (const resolvable of subjects) {
    const { subjectId } = await resolveSubjectUnderLock(tx, resolvable, origin, similarity);
    labelled.push([resolvable.mention.labelKey, subjectId]);
  }
  const ids = [...new Set(labelled.map(([, subjectId]) => subjectId))];
  const known = (await findSubjectsByIds(tx, ids)).flatMap(({ id, canonicalName, aliases }) =>
    [canonicalName, ...aliases].map((label) => [subjectLabelKey(label), id] as const),
  );
  const byLabelKey = [...labelled, ...known].reduce(
    (byKey, [labelKey, subjectId]) =>
      byKey.set(labelKey, [...new Set([...(byKey.get(labelKey) ?? []), subjectId])]),
    new Map<string, readonly string[]>(),
  );
  return { ids, byLabelKey };
};

// A fact names its subjects by their labels: the one a candidate of its document was
// given, or one its subject already goes by. A label that designates none of the subjects
// of the document names nothing: no subject is created from a bare name, which has no
// kind. An entity merged away since the pipeline resolved it is dropped rather than
// written: `facts.entity_ids` has no foreign key to catch it.
const toFactRows = async (
  tx: SubjectTransaction,
  { facts, factEmbeddings }: PreparedKnowledge,
  subjectIds: ReadonlyMap<string, readonly string[]>,
): Promise<readonly FactRow[]> => {
  const missing = new Set(
    await missingEntityIds(tx, [...new Set(facts.flatMap(({ entityIds }) => entityIds))]),
  );
  return facts.map(({ subjectLabelKeys, ...fact }, index) => ({
    ...fact,
    entityIds: fact.entityIds.filter((id) => !missing.has(id)),
    subjectIds: [...new Set(subjectLabelKeys.flatMap((key) => subjectIds.get(key) ?? []))],
    embedding: factEmbeddings?.[index] ?? null,
  }));
};

/**
 * Stores the prepared knowledge of a document in the transaction that writes the
 * document, in place of what a previous extraction stored: key dates, facts, and the
 * subjects it concerns. All or nothing, with the transaction; stored twice, it gives the
 * same dates, facts and subjects.
 *
 * The caller has taken the subject lock (`withSubjectLock`, the lock of the entities)
 * before the row of the document. It is taken again here, which costs nothing when it is
 * held, and candidates are resolved under it, so every subject id written exists. A
 * subject the document no longer concerns, and that no other live document concerns, is
 * blanked (`blankOrphanSubjects`).
 */
export const persistKnowledge = (
  tx: SubjectTransaction,
  { id }: KnowledgeDocument,
  knowledge: PreparedKnowledge,
): Promise<PersistedKnowledge> =>
  withSubjectLock(tx, async (locked) => {
    const document = await lockDocument(locked, id);
    if (document === undefined) return { rejectedValues: knowledge.rejectedValues };
    const usable = withoutExternalEmbeddings(knowledge, document);
    const { ids, byLabelKey } = await resolveSubjects(locked, usable, {
      issuerId: document.issuerId,
      private: document.private,
    });
    await replaceKeyDates(locked, id, usable.keyDates);
    await replaceFacts(locked, id, document.language, await toFactRows(locked, usable, byLabelKey));
    await locked.update(documents).set({ subjectIds: ids }).where(eq(documents.id, id));
    await blankOrphanSubjects(
      locked,
      document.subjectIds.filter((subjectId) => !ids.includes(subjectId)),
    );
    return { rejectedValues: knowledge.rejectedValues };
  });

export interface PersistedKnowledge {
  // Values of the section dropped as not valid, for the trace of the extraction.
  readonly rejectedValues: number;
}

export interface PersistKnowledgeDeps {
  readonly identifierKey: IdentifierKey;
  // The thresholds of entities, which subjects are resolved on.
  readonly similarity?: SimilarityThresholds;
}

const isPrepared = (
  knowledge: KnowledgeInput | PreparedKnowledge,
): knowledge is PreparedKnowledge => 'prepared' in knowledge;

/**
 * `persistKnowledge` in the shape the pipeline injects: given what `prepareKnowledge`
 * returned, it stores it; given the knowledge section as extraction produced it, it
 * prepares it without any model first (see `prepareWithoutModels`).
 */
export const createPersistKnowledge =
  ({ identifierKey, similarity = ENTITY_SIMILARITY }: PersistKnowledgeDeps) =>
  (
    tx: SubjectTransaction,
    document: KnowledgeDocument,
    knowledge: KnowledgeInput | PreparedKnowledge,
  ): Promise<PersistedKnowledge> =>
    persistKnowledge(
      tx,
      document,
      isPrepared(knowledge)
        ? knowledge
        : prepareWithoutModels(identifierKey, knowledge, similarity),
    );
