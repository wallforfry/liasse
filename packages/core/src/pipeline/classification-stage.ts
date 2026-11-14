import { eq } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { MANUAL_TYPE_FIELD } from '../domain/provenance.ts';
import { findCandidates } from './classify/candidates.ts';
import { decideType, type TypeDecision } from './classify/decide-type.ts';
import type { PipelineDeps } from './deps.ts';
import { type PipelineDocument, withPipelineProvenance, writeFromStatus } from './document.ts';
import { loadPages } from './pages.ts';
import { CLASSIFICATION_OPENING_TOKENS, openingOf } from './token-budget.ts';

const hasManualType = ({ manualFields }: PipelineDocument): boolean =>
  manualFields.includes(MANUAL_TYPE_FIELD);

// `confidence` is what tells a classified document whose fields are extracted from one
// whose fields are not: a new classification puts the extraction back to do.
const storeDecision = (
  { db }: PipelineDeps,
  documentId: string,
  decision: TypeDecision | undefined,
): Promise<boolean> =>
  writeFromStatus(db, documentId, ['extracted'], async (tx, current) => {
    const typed =
      decision === undefined || hasManualType(current)
        ? {}
        : {
            typeId: decision.typeId,
            provenance: withPipelineProvenance(current.provenance, { type: decision.provenance }),
          };
    await tx
      .update(documents)
      .set({ ...typed, status: 'classified', confidence: null })
      .where(eq(documents.id, documentId));
  });

/**
 * `extracted` to `classified`. A type chosen by a person stands: the model is not asked,
 * and a correction that arrives while it answers wins over its answer.
 */
export const runClassificationStage = async (
  deps: PipelineDeps,
  document: PipelineDocument,
  signal: AbortSignal,
): Promise<void> => {
  if (hasManualType(document)) {
    await storeDecision(deps, document.id, undefined);
    return;
  }
  const opening = openingOf(await loadPages(deps.db, document.id), CLASSIFICATION_OPENING_TOKENS);
  const candidates = await findCandidates(deps, opening, document.private);
  const decision = await decideType(deps, { opening, candidates, hint: document.hint }, signal);
  await storeDecision(deps, document.id, decision);
};
