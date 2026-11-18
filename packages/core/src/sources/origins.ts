import { isLiveStatus } from '@liasse/contract/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documentOrigins, ingestionSources } from '../db/schema/sources.ts';
import type { IngestResult, Transaction } from '../ingest/existing-document.ts';
import { cleanFilename } from '../ingest/untrusted-text.ts';

export interface Origin {
  readonly sourceId: string;
  readonly externalId: string;
  readonly name: string;
  /** What the source says of the bytes, when it keeps the file; null otherwise. */
  readonly checksum: string | null;
}

/**
 * Records where a document was found, in the transaction that ingested it. A tombstone
 * gets no origin: it keeps no derived row. The row of the source is held until the commit,
 * so a deletion of the source waits, and a source deleted meanwhile records nothing.
 *
 * An origin seen again takes the name and checksum the source gives now and is no longer
 * marked removed: a file restored at its source serves the document again.
 */
export const recordOrigin = async (
  tx: Transaction,
  origin: Origin,
  result: IngestResult,
): Promise<void> => {
  if (!isLiveStatus(result.status)) return;
  const [source] = await tx
    .select({ id: ingestionSources.id })
    .from(ingestionSources)
    .where(eq(ingestionSources.id, origin.sourceId))
    .for('key share');
  if (source === undefined) return;
  const name = cleanFilename(origin.name);
  await tx
    .insert(documentOrigins)
    .values({
      documentId: result.id,
      sourceId: origin.sourceId,
      externalId: origin.externalId,
      name,
      checksum: origin.checksum,
    })
    .onConflictDoUpdate({
      target: [documentOrigins.documentId, documentOrigins.sourceId, documentOrigins.externalId],
      set: { name, checksum: origin.checksum, removedAt: null },
    });
};

/**
 * Marks the origins of an item its source no longer holds. The documents and their
 * knowledge stay. Resolves to the number of origins newly marked.
 */
export const markOriginsRemoved = async (
  db: Database,
  sourceId: string,
  externalId: string,
): Promise<number> => {
  const marked = await db
    .update(documentOrigins)
    .set({ removedAt: sql`now()` })
    .where(
      and(
        eq(documentOrigins.sourceId, sourceId),
        eq(documentOrigins.externalId, externalId),
        isNull(documentOrigins.removedAt),
      ),
    )
    .returning({ documentId: documentOrigins.documentId });
  return marked.length;
};
