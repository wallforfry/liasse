import type { DocumentSource } from '@liasse/contract/domain';
import { documentLinks } from '../db/schema/knowledge.ts';
import { IngestError } from '../ingest/errors.ts';
import { ingestFile } from '../ingest/ingest-file.ts';
import { writeIfBothLive } from '../ingest/live-write.ts';
import type { ExtractedAttachment } from '../text/types.ts';
import type { PipelineDeps } from './deps.ts';

export interface AttachmentCounts {
  readonly ingested: number;
  readonly skipped: number;
}

interface ParentDocument {
  readonly id: string;
  readonly source: DocumentSource;
}

// True when the attachment is a document of its own, linked to the email. Bytes that
// already have a document are linked to it. A deleted document stays deleted whatever
// the source of the email (a person deleted it), and neither it nor an email deleted
// meanwhile gets a link.
const ingestAttachment = async (
  { db, storage, settings }: PipelineDeps,
  parent: ParentDocument,
  { filename, bytes }: ExtractedAttachment,
): Promise<boolean> => {
  const ingested = await ingestFile(
    { db, storage, maxFileSize: settings.maxFileSize },
    { bytes, filename, source: parent.source, revivesDeleted: false },
  ).catch((error: unknown) => {
    if (error instanceof IngestError) return undefined;
    throw error;
  });
  if (ingested === undefined || ingested.id === parent.id) return false;
  const link = await writeIfBothLive(db, [ingested.id, parent.id], (tx) =>
    tx
      .insert(documentLinks)
      .values({ fromDocumentId: ingested.id, toDocumentId: parent.id, kind: 'attachment_of' })
      .onConflictDoNothing(),
  );
  return link.written;
};

/**
 * Ingests each attachment of an email as its own document, from the same source, and
 * links it to the email. A part displayed inside the message (a logo, a pasted picture)
 * is not an attachment, and a file of a format ingestion refuses is left out: both are
 * counted as skipped. Running it again changes nothing: ingestion deduplicates by hash
 * and a link exists once.
 */
export const ingestAttachments = async (
  deps: PipelineDeps,
  parent: ParentDocument,
  attachments: readonly ExtractedAttachment[],
): Promise<AttachmentCounts> => {
  let ingested = 0;
  for (const attachment of attachments) {
    if (!attachment.inline && (await ingestAttachment(deps, parent, attachment))) ingested += 1;
  }
  return { ingested, skipped: attachments.length - ingested };
};
