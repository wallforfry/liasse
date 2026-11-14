import { eq } from 'drizzle-orm';
import { documents } from '../../db/schema/documents.ts';
import { docTypes } from '../../db/schema/registry.ts';
import type { DocumentStatus } from '../../domain/enums.ts';
import { languageCodeSchema } from '../../domain/values.ts';
import { PROVENANCE_ENTITY_ID_KEY } from '../../domain/provenance.ts';
import type { Transaction } from '../../ingest/existing-document.ts';
import { writeIfLive } from '../../ingest/live-write.ts';
import { isPlainRecord } from '../../registry/own.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
import { entitiesOf } from '../bindings.ts';
import type { PipelineDeps } from '../deps.ts';
import { loadDocument, type PipelineDocument } from '../document.ts';
import { storeKnowledge } from '../knowledge-store.ts';
import type { ExtractedDocument } from './interpret.ts';
import { mergeWithStored } from './merge.ts';

export const EXTRACTION_MODES = ['process', 'reextract'] as const;
export type ExtractionMode = (typeof EXTRACTION_MODES)[number];

// `stored`: written. `skipped`: the document is gone, or no longer where this
// extraction started from, and nothing is owed. `stale`: the type or an entity the
// result was computed from changed meanwhile, and the result must be computed again.
export type StoreOutcome = 'stored' | 'skipped' | 'stale';

const REEXTRACTABLE: readonly DocumentStatus[] = ['indexed', 'needs_review'];

// A classified document without a confidence has not had its fields extracted yet.
export const awaitsExtraction = (
  { status, confidence }: Pick<PipelineDocument, 'status' | 'confidence'>,
  mode: ExtractionMode,
): boolean =>
  mode === 'process'
    ? status === 'classified' && confidence === null
    : REEXTRACTABLE.includes(status);

export const entityIdsIn = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) return value.flatMap(entityIdsIn);
  if (!isPlainRecord(value)) return [];
  const id = value[PROVENANCE_ENTITY_ID_KEY];
  return typeof id === 'string' ? [id] : Object.values(value).flatMap(entityIdsIn);
};

// The row is read `FOR SHARE`: a registry write to this type waits for the commit, so
// the document is never stored against a version the type has already left.
export const isCurrentType = async (tx: Transaction, type: RegisteredType): Promise<boolean> => {
  const [row] = await tx
    .select({ version: docTypes.version, status: docTypes.status })
    .from(docTypes)
    .where(eq(docTypes.id, type.id))
    .for('share');
  return row?.version === type.version && row.status !== 'merged';
};

export interface StoreInput {
  readonly documentId: string;
  /** `documents.type_id` as it was when the extraction started. */
  readonly typeIdRead: string | null;
  /** The type the values were extracted for: the target, when `typeIdRead` is merged. */
  readonly type: RegisteredType | undefined;
  readonly fresh: ExtractedDocument;
  readonly model: string;
  readonly truncated: boolean;
  readonly mode: ExtractionMode;
}

const write = async (
  deps: PipelineDeps,
  tx: Transaction,
  { documentId, typeIdRead, type, fresh, model, truncated, mode }: StoreInput,
): Promise<StoreOutcome> => {
  const stored = await loadDocument(tx, documentId);
  if (stored === undefined || !awaitsExtraction(stored, mode)) return 'skipped';
  if (stored.typeId !== typeIdRead) return 'stale';
  if (type !== undefined && !(await isCurrentType(tx, type))) return 'stale';
  const entityIds = [
    ...new Set([
      ...entityIdsIn(fresh.provenance),
      ...fresh.knowledge.facts.flatMap((fact) => fact.entityIds),
    ]),
  ];
  if ((await entitiesOf(deps).missingIds(tx, entityIds)).length > 0) return 'stale';
  const merged = mergeWithStored(stored, fresh, {
    type,
    truncated,
    model,
    keepProvenanceOfUnchanged: mode === 'reextract',
  });
  await tx
    .update(documents)
    .set({ ...merged, typeId: type?.id ?? null, schemaVersion: type?.version ?? null })
    .where(eq(documents.id, documentId));
  await (deps.persistKnowledge ?? storeKnowledge)(
    tx,
    {
      id: documentId,
      private: stored.private,
      language: languageCodeSchema.safeParse(merged.core.language).data ?? null,
    },
    fresh.knowledge,
  );
  return 'stored';
};

/**
 * Writes the result of one extraction, with its knowledge, in one transaction.
 *
 * The entity lock is taken before the row of the document, the order a merge of
 * entities takes them in, and the ids are checked under it: an entity merged away after
 * it was resolved is never written. Values a person corrected are kept as they are.
 */
export const storeExtraction = (deps: PipelineDeps, input: StoreInput): Promise<StoreOutcome> =>
  entitiesOf(deps).withLock(deps.db, async (locked) => {
    const outcome = await writeIfLive(locked, input.documentId, (tx) => write(deps, tx, input));
    return outcome.written ? outcome.result : 'skipped';
  });
