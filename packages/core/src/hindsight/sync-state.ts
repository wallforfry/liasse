import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { facts } from '../db/schema/knowledge.ts';
import { docTypes } from '../db/schema/registry.ts';
import { isLiveStatus } from '../domain/enums.ts';
import { isoDateSchema } from '../domain/values.ts';
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
 * private since it was read: its facts must then not be sent.
 */
export const recordRetainStarted = async (db: Database, documentId: string): Promise<boolean> => {
  const marked = await db
    .update(documents)
    .set({
      hindsightHeldSince: sql`coalesce(${documents.hindsightHeldSince}, now())`,
      hindsightSentHash: null,
      ...KEEP_UPDATED_AT,
    })
    .where(and(eq(documents.id, documentId), isLiveDocument, eq(documents.private, false)))
    .returning({ id: documents.id });
  return marked.length > 0;
};

// A document deleted during the retain is left as its tombstone, without a hash: what
// it keeps is the record that Hindsight may hold its facts.
export const recordRetained = async (
  db: Database,
  documentId: string,
  sentHash: string,
): Promise<void> => {
  await db
    .update(documents)
    .set({ hindsightSentHash: sentHash, ...KEEP_UPDATED_AT })
    .where(
      and(eq(documents.id, documentId), isLiveDocument, isNotNull(documents.hindsightHeldSince)),
    );
};

/** To call only once Hindsight confirmed that it holds nothing of the document. */
export const recordForgotten = async (db: Database, documentId: string): Promise<void> => {
  await db
    .update(documents)
    .set({ hindsightHeldSince: null, hindsightSentHash: null, ...KEEP_UPDATED_AT })
    .where(eq(documents.id, documentId));
};
