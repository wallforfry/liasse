import { eq } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import type { DocumentStatus } from '../domain/enums.ts';
import { readPipelineProvenance } from '../domain/provenance.ts';
import { DocumentNotFoundError } from '../search/indexing.ts';
import { indexerOf } from './bindings.ts';
import { runClassificationStage } from './classification-stage.ts';
import { settledStatus } from './confidence.ts';
import type { PipelineDeps } from './deps.ts';
import { loadDocument, writeFromStatus } from './document.ts';
import { PipelineConflictError } from './errors.ts';
import { extractDocument } from './extraction-stage.ts';
import { runTextStage } from './text-stage.ts';

const SETTLED: readonly DocumentStatus[] = ['indexed', 'needs_review'];

// More steps than a document has stages: a status that does not move is a defect or a
// writer working against this one, and the job fails rather than spin.
const MAX_STEPS = 8;

const settle = (
  { db, settings }: PipelineDeps,
  documentId: string,
  from: readonly DocumentStatus[],
): Promise<boolean> =>
  writeFromStatus(db, documentId, from, async (tx, current) => {
    await tx
      .update(documents)
      .set({
        status: settledStatus(
          current.confidence,
          readPipelineProvenance(current.provenance).type,
          settings.confidenceThreshold,
        ),
      })
      .where(eq(documents.id, documentId));
  });

// The indexer refuses a tombstone: a document deleted meanwhile has nothing to index,
// and the stage that follows finds it gone.
const index = async (deps: PipelineDeps, documentId: string): Promise<void> => {
  const run = indexerOf(deps);
  await run(documentId).catch((error: unknown) => {
    if (!(error instanceof DocumentNotFoundError)) throw error;
  });
};

/** Indexes the document, then gives it the status its confidence calls for. */
export const indexAndSettle = async (
  deps: PipelineDeps,
  documentId: string,
  from: readonly DocumentStatus[],
): Promise<void> => {
  await index(deps, documentId);
  await settle(deps, documentId, from);
};

/**
 * Takes a document from the status it has to `indexed` or `needs_review`, one stage at
 * a time. Each stage reads what the previous ones stored and writes over the status it
 * started from only, so a job that is retried, or runs twice, resumes where the
 * document is. A document that is gone, deleted or failed is left alone.
 */
export const processDocument = async (
  deps: PipelineDeps,
  documentId: string,
  signal: AbortSignal,
): Promise<void> => {
  for (let step = 0; step < MAX_STEPS; step += 1) {
    signal.throwIfAborted();
    const document = await loadDocument(deps.db, documentId);
    if (document === undefined || document.status === 'failed') return;
    if (SETTLED.includes(document.status)) {
      await deps.afterIndexed?.(documentId);
      return;
    }
    if (document.status === 'received') await runTextStage(deps, document, signal);
    else if (document.status === 'extracted') await runClassificationStage(deps, document, signal);
    else if (document.confidence === null)
      await extractDocument(deps, documentId, 'process', signal);
    else await indexAndSettle(deps, documentId, ['classified']);
  }
  throw new PipelineConflictError(documentId);
};

/** Resolves once the document is extracted again and indexed, or was left alone. */
export const reextractDocument = async (
  deps: PipelineDeps,
  documentId: string,
  signal: AbortSignal,
): Promise<void> => {
  if (!(await extractDocument(deps, documentId, 'reextract', signal))) return;
  await indexAndSettle(deps, documentId, SETTLED);
  await deps.afterIndexed?.(documentId);
};

export const reindexDocument = async (deps: PipelineDeps, documentId: string): Promise<void> => {
  const document = await loadDocument(deps.db, documentId);
  if (document === undefined || !SETTLED.includes(document.status)) return;
  await index(deps, documentId);
  await deps.afterIndexed?.(documentId);
};
