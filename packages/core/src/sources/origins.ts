import { isLiveStatus } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { documentOrigins, ingestionSources } from '../db/schema/sources.ts';
import type { IngestResult, Transaction } from '../ingest/existing-document.ts';
import { cleanFilename } from '../ingest/untrusted-text.ts';

export interface Origin {
  readonly sourceId: string;
  readonly externalId: string;
  readonly name: string;
}

/**
 * Records where a document was found, in the transaction that ingested it. A tombstone
 * gets no origin: it keeps no derived row. The row of the source is held until the commit,
 * so a deletion of the source waits, and a source deleted meanwhile records nothing.
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
  await tx
    .insert(documentOrigins)
    .values({
      documentId: result.id,
      sourceId: origin.sourceId,
      externalId: origin.externalId,
      name: cleanFilename(origin.name),
    })
    .onConflictDoNothing();
};
