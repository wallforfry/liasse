import { supportedMimeSchema } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { documentPages, documents } from '../db/schema/documents.ts';
import { getDocumentFile } from '../ingest/document-file.ts';
import type { ExtractedText } from '../text/types.ts';
import { type AttachmentCounts, ingestAttachments } from './attachments.ts';
import type { ExtractDocumentText, PipelineDeps } from './deps.ts';
import { type PipelineDocument, withPipelineProvenance, writeFromStatus } from './document.ts';
import { DocumentProcessingError } from './errors.ts';
import { extractTextInChild } from './text-process/extract-in-child.ts';

const hasText = ({ pages }: ExtractedText): boolean => pages.some(({ text }) => text.trim() !== '');

const storeText = (
  { db }: PipelineDeps,
  documentId: string,
  { pages, method, visionModel }: ExtractedText,
  attachments: AttachmentCounts,
): Promise<boolean> =>
  writeFromStatus(db, documentId, ['received'], async (tx, document) => {
    await tx.delete(documentPages).where(eq(documentPages.documentId, documentId));
    await tx
      .insert(documentPages)
      .values(pages.map(({ page, text }) => ({ documentId, page, text })));
    await tx
      .update(documents)
      .set({
        status: 'extracted',
        provenance: withPipelineProvenance(document.provenance, {
          text: {
            method,
            ...(visionModel === undefined ? {} : { vision_model: visionModel }),
            attachments_ingested: attachments.ingested,
            attachments_skipped: attachments.skipped,
          },
        }),
      })
      .where(eq(documents.id, documentId));
  });

/**
 * `received` to `extracted`: reads the stored file, extracts its text outside the
 * server's process, ingests the attachments of an email and stores the pages.
 *
 * The attachments are ingested before the status moves: a crash between the two redoes
 * the stage, which finds them already there, where the other order would lose them.
 */
export const runTextStage = async (
  deps: PipelineDeps,
  document: PipelineDocument,
  signal: AbortSignal,
): Promise<void> => {
  const file = await getDocumentFile(deps, document.id);
  if (file === undefined) return;
  const mime = supportedMimeSchema.safeParse(file.mime);
  if (!mime.success) throw new DocumentProcessingError('unsupported_mime');
  const { maxVisionPages, textProcessLimits } = deps.settings;
  const outOfProcess: ExtractDocumentText = (input, extraction) =>
    extractTextInChild(input, {
      ...extraction,
      ...(textProcessLimits === undefined ? {} : { processLimits: textProcessLimits }),
    });
  const text = await (deps.extractText ?? outOfProcess)(
    { bytes: await file.bytes(), mime: mime.data },
    {
      vision: deps.visionModel,
      signal,
      ...(maxVisionPages === undefined ? {} : { limits: { maxVisionPages } }),
    },
  );
  if (!hasText(text)) throw new DocumentProcessingError('no_text');
  const attachments = await ingestAttachments(deps, document, text.attachments);
  await storeText(deps, document.id, text, attachments);
};
