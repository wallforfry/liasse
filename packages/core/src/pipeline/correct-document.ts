import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from '../db/schema/documents.ts';
import { writeIfLive } from '../ingest/live-write.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { resolveType } from '../registry/read-types.ts';
import { findTypeById, type RegisteredType } from '../registry/type-store.ts';
import { entitiesOf, maskOf } from './bindings.ts';
import { applyCorrection, type Correction } from './correction/apply.ts';
import {
  changedConfirmations,
  type Confirmations,
  planConfirm,
  valueChanged,
} from './correction/confirm.ts';
import {
  type CorrectionError,
  correctionInputSchema,
  type CorrectionRequest,
  EMPTY_PATCH,
  planCore,
  planFields,
  type Planned,
  type SectionPatch,
} from './correction/plan.ts';
import type { PipelineDeps } from './deps.ts';
import { loadDocument, type PipelineDocument } from './document.ts';
import { PipelineConflictError } from './errors.ts';
import { mentionKey, resolveMentions } from './extract/entities.ts';
import { isCurrentType } from './extract/store.ts';
import { reextractDocumentJob, reindexDocumentJob } from './jobs.ts';

const MAX_ATTEMPTS = 3;

const refused = (...errors: readonly CorrectionError[]): Planned<never> => ({ ok: false, errors });

interface TargetType {
  readonly type: RegisteredType | undefined;
  readonly changed: boolean;
}

const targetType = async (
  { db }: PipelineDeps,
  document: PipelineDocument,
  slug: string | undefined,
): Promise<TargetType | undefined> => {
  if (slug !== undefined) {
    const type = await resolveType(slug, { db });
    return type === undefined ? undefined : { type, changed: type.id !== document.typeId };
  }
  const type = document.typeId === null ? undefined : await findTypeById(db, document.typeId);
  return {
    type: type?.status === 'merged' ? await resolveType(type.slug, { db }) : type,
    changed: false,
  };
};

const planFieldsFor = (
  patch: Readonly<Record<string, unknown>> | undefined,
  type: RegisteredType | undefined,
): Planned<SectionPatch> => {
  if (patch === undefined) return { ok: true, value: EMPTY_PATCH };
  return type === undefined
    ? refused({
        code: 'no_type',
        message: 'The document has no type, so it has no field: give it a type first.',
      })
    : planFields(patch, type.fields);
};

const entityNames = (...patches: readonly SectionPatch[]): readonly string[] =>
  patches.flatMap(({ entityNames: names }) => Object.values(names).flat());

// A confirmation of a value that changed since it was read is refused, never retried: the
// person vouched for the value they saw, not for the one stored now.
interface Changed {
  readonly changed: readonly string[];
}

type Applied = PipelineDocument | 'stale' | Changed | undefined;

// A settled document is indexed again, since its chunks carry its title and its type
// and obey its `private` flag; after a change of type its fields are extracted again
// first. A document still on its way gets both from the pipeline.
const apply = (
  deps: PipelineDeps,
  read: PipelineDocument,
  correction: Correction,
): Promise<Applied> =>
  entitiesOf(deps).withLock(deps.db, async (locked) => {
    const outcome = await writeIfLive(locked, read.id, async (tx): Promise<Applied> => {
      const stored = await loadDocument(tx, read.id);
      if (stored === undefined) return undefined;
      const changed = changedConfirmations(stored, correction.confirm);
      if (changed.length > 0) return { changed };
      const { type } = correction;
      if (stored.typeId !== read.typeId) return 'stale';
      if (type !== undefined && !(await isCurrentType(tx, type))) return 'stale';
      // The ids this correction brings in: those the document already holds are kept
      // true by the merges themselves.
      const resolved = [...correction.resolutions.values()].map((entity) => entity.entity_id);
      if ((await entitiesOf(deps).missingIds(tx, resolved)).length > 0) return 'stale';
      await tx
        .update(documents)
        .set(applyCorrection(stored, correction))
        .where(eq(documents.id, read.id));
      if (correction.private !== undefined && correction.private !== stored.private) {
        await deps.onPrivacyChanged?.(tx, read.id);
      }
      if (stored.status === 'indexed' || stored.status === 'needs_review') {
        await enqueue(tx, {
          kind: correction.typeChanged ? reextractDocumentJob : reindexDocumentJob,
          payload: { documentId: read.id },
        });
      }
      return loadDocument(tx, read.id);
    });
    return outcome.written ? outcome.result : undefined;
  });

interface PlannedSections {
  readonly core: SectionPatch;
  readonly fields: SectionPatch;
  readonly confirm: Confirmations;
}

// Every refusal at once, so the person fixes the whole request in one go.
const planSections = (
  { core: corePatch, fields: fieldsPatch, confirm = {} }: CorrectionRequest,
  document: PipelineDocument,
  type: RegisteredType | undefined,
): Planned<PlannedSections> => {
  const core =
    corePatch === undefined ? { ok: true as const, value: EMPTY_PATCH } : planCore(corePatch);
  const fields = planFieldsFor(fieldsPatch, type);
  const corrected = [...Object.keys(corePatch ?? {}), ...Object.keys(fieldsPatch ?? {})];
  const confirmed = planConfirm(confirm, corrected, document);
  return core.ok && fields.ok && confirmed.ok
    ? { ok: true, value: { core: core.value, fields: fields.value, confirm: confirmed.value } }
    : refused(
        ...(core.ok ? [] : core.errors),
        ...(fields.ok ? [] : fields.errors),
        ...(confirmed.ok ? [] : confirmed.errors),
      );
};

const NOT_FOUND = (id: string): CorrectionError => ({
  code: 'document_not_found',
  message: `No document has the id "${id}".`,
});

/**
 * `update_document`: writes what a person says of a document over what was extracted.
 * The values are validated by the registry, entity names are resolved again, sensitive
 * identifiers are masked, and the provenance of each corrected value says it is manual.
 * From then on neither `process_document` nor a re-extraction writes those fields.
 */
export const correctDocument = async (
  deps: PipelineDeps,
  rawInput: unknown,
): Promise<Planned<PipelineDocument>> => {
  const input = correctionInputSchema.safeParse(rawInput);
  if (!input.success)
    return refused({ code: 'invalid_input', message: z.prettifyError(input.error) });
  const { id, type: slug } = input.data;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const document = await loadDocument(deps.db, id);
    if (document === undefined) return refused(NOT_FOUND(id));
    const target = await targetType(deps, document, slug);
    if (target === undefined) {
      return refused({
        code: 'type_not_found',
        message: `No type has the slug or alias "${slug ?? ''}".`,
      });
    }
    const planned = planSections(input.data, document, target.type);
    if (!planned.ok) return planned;
    const { core, fields, confirm } = planned.value;
    const names = entityNames(core, fields);
    const bound = { entities: entitiesOf(deps), maskSensitive: maskOf(deps) };
    const { resolutions } = await resolveMentions(bound, names, {
      details: [],
      documentText: '',
      allowExternalEmbedding: !(input.data.private ?? document.private),
    });
    const unresolved = names.filter((name) => !resolutions.has(mentionKey(name)));
    if (unresolved.length > 0) {
      return refused({
        code: 'unresolved_entity',
        message: 'An entity name of the correction could not be resolved to an entity.',
      });
    }
    const applied = await apply(deps, document, {
      type: target.type,
      typeGiven: slug !== undefined,
      typeChanged: target.changed,
      core,
      fields,
      confirm,
      private: input.data.private,
      resolutions,
      maskSensitive: maskOf(deps),
    });
    if (applied === undefined) return refused(NOT_FOUND(id));
    if (applied === 'stale') continue;
    if ('changed' in applied) return refused(valueChanged(applied.changed));
    return { ok: true, value: applied };
  }
  throw new PipelineConflictError(id);
};
