import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { documentLinks } from '../db/schema/knowledge.ts';
import type { DocumentState, LinkKind, SubjectKind } from '../domain/enums.ts';
import { effectiveState, holdsId } from './read-shared.ts';

// What the state of a subject is read from, for each of its documents.
export interface SubjectDocumentState {
  readonly state: DocumentState;
  // The document ends another one: a termination letter says nothing of its own life.
  readonly terminatesAnother: boolean;
  // The document supersedes, amends or is superseded, amended or terminated: it is part
  // of the life of a contract, where a bill or a receipt is not.
  readonly inContractThread: boolean;
}

// The kinds of subject that live and end with a contract. A home or a car does not end
// when its insurance does.
const CONTRACTUAL_KINDS: readonly SubjectKind[] = ['contract', 'employment', 'account'];

/**
 * The state of a subject, from the states of its documents.
 *
 * A contract, a job or an account is what its contract documents say: current while one
 * of them is, otherwise terminated if one was terminated, otherwise superseded. Bills,
 * receipts and the letter that ends the contract stay `current` for ever and say nothing
 * of it. Without any such document it is current: nothing says it ended.
 *
 * A property, a vehicle or a dependent is current while any of its documents is.
 */
export const deriveSubjectState = (
  kind: SubjectKind,
  documentStates: readonly SubjectDocumentState[],
): DocumentState => {
  const telling = documentStates.filter(
    ({ terminatesAnother, inContractThread }) =>
      !terminatesAnother && (inContractThread || !CONTRACTUAL_KINDS.includes(kind)),
  );
  if (telling.length === 0 || telling.some(({ state }) => state === 'current')) return 'current';
  return telling.some(({ state }) => state === 'terminated') ? 'terminated' : 'superseded';
};

const THREAD_KINDS: readonly LinkKind[] = ['supersedes', 'amends', 'terminates'];

const hasLink = (condition: SQL | undefined): SQL<boolean> =>
  sql<boolean>`EXISTS (SELECT 1 FROM ${documentLinks} WHERE ${condition})`;

export const readSubjectDocumentStates = (
  db: Database,
  subjectId: string,
  visible: SQL,
): Promise<readonly SubjectDocumentState[]> =>
  db
    .select({
      state: effectiveState,
      terminatesAnother: hasLink(
        and(eq(documentLinks.fromDocumentId, documents.id), eq(documentLinks.kind, 'terminates')),
      ),
      inContractThread: hasLink(
        and(
          inArray(documentLinks.kind, [...THREAD_KINDS]),
          or(
            eq(documentLinks.fromDocumentId, documents.id),
            eq(documentLinks.toDocumentId, documents.id),
          ),
        ),
      ),
    })
    .from(documents)
    .where(and(holdsId(documents.subjectIds, subjectId), visible));
