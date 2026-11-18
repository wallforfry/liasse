import { SETTLED_STATUSES } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { MANUAL_TYPE_FIELD, type TypeProvenance } from '../domain/provenance.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { recordDocumentEvent } from '../processing-log/record.ts';
import { findTypeById, type RegisteredType } from '../registry/type-store.ts';
import { findCandidates } from './classify/candidates.ts';
import { classificationEvent, decideType, type TypeDecision } from './classify/decide-type.ts';
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
  type: RegisteredType,
  provenance: TypeProvenance,
) => {
  const moved = moveFields(current, type);
  return {
    typeId: type.id,
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
  decision: Extract<TypeDecision, { readonly typeId: string }>,
): Promise<boolean> =>
  writeFromStatus(db, payload.documentId, SETTLED_STATUSES, async (tx, current) => {
    if (current.typeId !== payload.rejectedTypeId) return;
    const type = await findTypeById(tx, decision.typeId);
    // A type merge can make the decided type one of the rejected ones meanwhile.
    if (
      type === undefined ||
      current.rejectedTypeIds.includes(type.id) ||
      !(await isCurrentType(tx, type))
    ) {
      throw new PipelineConflictError(payload.documentId);
    }
    await tx
      .update(documents)
      .set(reclassified(current, type, decision.provenance))
      .where(eq(documents.id, payload.documentId));
    await recordDocumentEvent(tx, payload.documentId, {
      stage: 'classification',
      outcome: 'succeeded',
      status: current.status,
      ...classificationEvent(decision),
    });
    await enqueue(tx, { kind: reextractDocumentJob, payload: { documentId: payload.documentId } });
  });

// A new type that could not be created changes nothing: the document keeps its type, its
// values and its status, so no type it is not takes the place of the rejected one and no
// re-extraction for such a type drops its values. The log says why, for the caller.
const storeRefusal = (
  { db }: PipelineDeps,
  payload: Readonly<ReclassifyPayload>,
  decision: Extract<TypeDecision, { readonly typeId: null }>,
): Promise<boolean> =>
  writeFromStatus(db, payload.documentId, SETTLED_STATUSES, async (tx, current) => {
    if (current.typeId !== payload.rejectedTypeId) return;
    await recordDocumentEvent(tx, payload.documentId, {
      stage: 'classification',
      outcome: 'failed',
      status: current.status,
      errorCode: decision.refusal,
      retryable: false,
      ...classificationEvent(decision),
    });
  });

const typesOf = async (
  { db }: PipelineDeps,
  ids: readonly string[],
): Promise<readonly RegisteredType[]> =>
  (await Promise.all(ids.map((id) => findTypeById(db, id)))).filter(
    (type): type is RegisteredType => type !== undefined,
  );

/**
 * `reclassify_document`: the classification of a settled document again, without any
 * type a person rejected for it since its type was last set by hand, with what they
 * said. The request added the rejected type to `rejected_type_ids`. A new type that
 * cannot be created, past the quota or refused, leaves the document as it was, with a
 * failed `classification` event whose code says why: no other existing type is assigned
 * in its place.
 */
export const reclassifyDocument = async (
  deps: PipelineDeps,
  payload: Readonly<ReclassifyPayload>,
  signal: AbortSignal,
): Promise<void> => {
  const document = await loadDocument(deps.db, payload.documentId);
  if (document === undefined || !stillRejected(document, payload)) return;
  const { rejectedTypeIds } = document;
  const rejected = await typesOf(deps, rejectedTypeIds);
  const opening = openingOf(await loadPages(deps.db, document.id), CLASSIFICATION_OPENING_TOKENS);
  const candidates = (await findCandidates(deps, opening, document.private)).filter(
    ({ type }) => !rejectedTypeIds.includes(type.id),
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
  await (decision.typeId === null
    ? storeRefusal(deps, payload, decision)
    : storeReclassification(deps, payload, decision));
};
