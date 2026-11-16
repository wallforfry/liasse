import { SETTLED_STATUSES } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { MANUAL_TYPE_FIELD, type TypeProvenance } from '../domain/provenance.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { recordDocumentEvent } from '../processing-log/record.ts';
import { findTypeById, type RegisteredType } from '../registry/type-store.ts';
import { findCandidates } from './classify/candidates.ts';
import { decideType, type TypeDecision } from './classify/decide-type.ts';
import { moveFields } from './correction/move-fields.ts';
import type { PipelineDeps } from './deps.ts';
import {
  loadDocument,
  type PipelineDocument,
  withPipelineProvenance,
  writeFromStatus,
} from './document.ts';
import { PipelineConflictError } from './errors.ts';
import { isCurrentType } from './extract/store.ts';
import { type ReclassifyPayload, reextractDocumentJob } from './jobs.ts';
import { loadPages } from './pages.ts';
import { CLASSIFICATION_OPENING_TOKENS, openingOf } from './token-budget.ts';

const stillRejected = (
  document: PipelineDocument,
  { rejectedTypeId }: Readonly<ReclassifyPayload>,
): boolean => SETTLED_STATUSES.includes(document.status) && document.typeId === rejectedTypeId;

// The type decided by the model, as a manual correction would set it: the extraction
// it owes is to do again, and the type is no longer the person's choice. The other
// manual marks stay, and so do the values they cover, wherever they move.
const reclassified = (
  current: PipelineDocument,
  type: RegisteredType | undefined,
  provenance: TypeProvenance,
) => {
  const moved = moveFields(current, type);
  return {
    typeId: type?.id ?? null,
    schemaVersion: null,
    confidence: null,
    fields: moved.fields,
    extra: moved.extra,
    provenance: withPipelineProvenance(current.provenance, { type: provenance }),
    manualFields: current.manualFields.filter((name) => name !== MANUAL_TYPE_FIELD),
  };
};

// The status stays: the re-extraction queued with the type settles the document.
const storeReclassification = (
  { db }: PipelineDeps,
  payload: Readonly<ReclassifyPayload>,
  { typeId, provenance }: TypeDecision,
): Promise<boolean> =>
  writeFromStatus(db, payload.documentId, SETTLED_STATUSES, async (tx, current) => {
    if (current.typeId !== payload.rejectedTypeId) return;
    const type = typeId === null ? undefined : await findTypeById(tx, typeId);
    if (typeId !== null && (type === undefined || !(await isCurrentType(tx, type)))) {
      throw new PipelineConflictError(payload.documentId);
    }
    await tx
      .update(documents)
      .set(reclassified(current, type, provenance))
      .where(eq(documents.id, payload.documentId));
    await recordDocumentEvent(tx, payload.documentId, {
      stage: 'classification',
      outcome: 'succeeded',
      status: current.status,
      ...('model' in provenance
        ? { model: provenance.model, details: { classification: provenance.outcome } }
        : {}),
    });
    await enqueue(tx, { kind: reextractDocumentJob, payload: { documentId: payload.documentId } });
  });

/**
 * `reclassify_document`: the classification of a settled document again, without the
 * type a person rejected, with what they said. The rules of the first classification
 * hold: past the quota, or when creation is refused, the closest other candidate is
 * assigned with a confidence of 0, and with none the document is left without a type,
 * so the re-extraction flags it for review either way.
 */
export const reclassifyDocument = async (
  deps: PipelineDeps,
  payload: Readonly<ReclassifyPayload>,
  signal: AbortSignal,
): Promise<void> => {
  const document = await loadDocument(deps.db, payload.documentId);
  if (document === undefined || !stillRejected(document, payload)) return;
  const { rejectedTypeId } = payload;
  const rejected =
    rejectedTypeId === null ? undefined : await findTypeById(deps.db, rejectedTypeId);
  const opening = openingOf(await loadPages(deps.db, document.id), CLASSIFICATION_OPENING_TOKENS);
  const candidates = (await findCandidates(deps, opening, document.private)).filter(
    ({ type }) => type.id !== rejectedTypeId,
  );
  const decision = await decideType(
    deps,
    {
      opening,
      candidates,
      hint: document.hint,
      mayCreate: !document.private || deps.embedder.isLocal,
      reclassification: {
        rejected,
        hint: document.reclassificationHint,
        requireNew: payload.newType,
      },
    },
    signal,
  );
  await storeReclassification(deps, payload, decision);
};
