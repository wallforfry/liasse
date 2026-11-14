import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { facts } from '../db/schema/knowledge.ts';
import { docTypes } from '../db/schema/registry.ts';
import { isLiveStatus } from '../domain/enums.ts';
import { isoDateSchema } from '../domain/values.ts';
import type { SyncSession } from './document-lock.ts';
import type { SyncedDocument, SyncedFact } from './memory.ts';

export interface SyncState {
  readonly document: SyncedDocument;
  /** False for a tombstone, which has no facts. */
  readonly live: boolean;
  readonly private: boolean;
  /** `documents.hindsight_held_since` is set: Hindsight may hold facts of the document. */
  readonly mayHold: boolean;
  /** `documents.hindsight_sent_hash`. */
  readonly sentHash: string | null;
  readonly facts: readonly SyncedFact[];
}

const datedCore = z.object({ document_date: isoDateSchema });

// The columns below are bookkeeping of the sync, not a change of the document:
// `updated_at` keeps its value.
const KEEP_UPDATED_AT = { updatedAt: sql`${documents.updatedAt}` };

const MAY_HOLD = sql`coalesce(${documents.hindsightHeldSince}, now())`;

/** Undefined for a document that never existed. A deleted one is read as its tombstone. */
export const readSyncState = async (
  db: Database,
  documentId: string,
): Promise<SyncState | undefined> => {
  const [row] = await db
    .select({
      status: documents.status,
      private: documents.private,
      heldSince: documents.hindsightHeldSince,
      sentHash: documents.hindsightSentHash,
      core: documents.core,
      typeSlug: docTypes.slug,
    })
    .from(documents)
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(eq(documents.id, documentId));
  if (row === undefined) return undefined;
  const dated = datedCore.safeParse(row.core);
  return {
    document: {
      id: documentId,
      typeSlug: row.typeSlug ?? undefined,
      documentDate: dated.success ? dated.data.document_date : undefined,
    },
    live: isLiveStatus(row.status),
    private: row.private,
    mayHold: row.heldSince !== null,
    sentHash: row.sentHash,
    facts: await db
      .select({ text: facts.text, validFrom: facts.validFrom, validTo: facts.validTo })
      .from(facts)
      .where(eq(facts.documentId, documentId))
      .orderBy(asc(facts.createdAt), asc(facts.id)),
  };
};

/**
 * Records, before a retain is sent, that Hindsight may hold facts of the document, and
 * forgets the hash: until the retain is confirmed, what the bank holds is not known.
 * Resolves to false, and writes nothing, when the document was deleted or flagged
 * private since it was read, or when the lock was lost: nothing may then be sent.
 */
export const recordRetainStarted = async (
  { db, holdsLock }: SyncSession,
  documentId: string,
): Promise<boolean> => {
  const marked = await db
    .update(documents)
    .set({ hindsightHeldSince: MAY_HOLD, hindsightSentHash: null, ...KEEP_UPDATED_AT })
    .where(
      and(eq(documents.id, documentId), isLiveDocument, eq(documents.private, false), holdsLock),
    )
    .returning({ id: documents.id });
  return marked.length > 0;
};

/**
 * For the end of every request, whatever its outcome, live row or tombstone: the bank
 * may hold facts of the document, and what it holds is not known. A sync that lost its
 * lock may have seen another clear both while its own request was in flight; this puts
 * the record back, so the next sync or the sweep forgets a document now private or
 * deleted, and retains again one whose facts the bank may not hold.
 */
export const recordOutcomeUnknown = async (db: Database, documentId: string): Promise<void> => {
  await db
    .update(documents)
    .set({ hindsightHeldSince: MAY_HOLD, hindsightSentHash: null, ...KEEP_UPDATED_AT })
    .where(eq(documents.id, documentId));
};

/**
 * Records the hash of a retain Hindsight confirmed, only while the lock is held: a sync
 * that lost it may have been overtaken, and the bank may hold another's facts. Writing
 * nothing leaves the hash null, which only costs the next sync a retain. A tombstone
 * never gets a hash, even from a deletion that commits after the facts were read back.
 */
export const recordRetained = async (
  { db, holdsLock }: SyncSession,
  documentId: string,
  sentHash: string,
): Promise<void> => {
  await db
    .update(documents)
    .set({ hindsightSentHash: sentHash, ...KEEP_UPDATED_AT })
    .where(and(eq(documents.id, documentId), isLiveDocument, holdsLock));
};

/**
 * To call only once Hindsight confirmed that it holds nothing of the document, and
 * only while the lock is held: a sync that lost it may have been overtaken by a retain.
 * Writing nothing leaves the record set, which only costs the next sync a forget.
 */
export const recordForgotten = async (
  { db, holdsLock }: SyncSession,
  documentId: string,
): Promise<void> => {
  await db
    .update(documents)
    .set({ hindsightHeldSince: null, hindsightSentHash: null, ...KEEP_UPDATED_AT })
    .where(and(eq(documents.id, documentId), holdsLock));
};
