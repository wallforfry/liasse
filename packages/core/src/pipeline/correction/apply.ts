import {
  MANUAL_PROVENANCE,
  MANUAL_TYPE_FIELD,
  PIPELINE_PROVENANCE_KEY,
  readPipelineProvenance,
} from '../../domain/provenance.ts';
import { ownValue } from '../../registry/own.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
import { validateDocumentFields } from '../../registry/validate-document-fields.ts';
import type { MaskSensitive } from '../deps.ts';
import type { PipelineDocument } from '../document.ts';
import { type EntityResolutions, mentionKey } from '../extract/entities.ts';
import { maskDeep } from '../extract/masking.ts';
import type { SectionPatch } from './plan.ts';

type Values = Readonly<Record<string, unknown>>;

export interface Correction {
  readonly type: RegisteredType | undefined;
  /** The request named a type, the current one included: a person vouches for it. */
  readonly typeGiven: boolean;
  readonly typeChanged: boolean;
  readonly core: SectionPatch;
  readonly fields: SectionPatch;
  readonly private: boolean | undefined;
  readonly resolutions: EntityResolutions;
  readonly maskSensitive: MaskSensitive;
}

const omit = (record: Values, names: readonly string[]): Values =>
  Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name)));

const namesOf = ({ set, clear }: SectionPatch): readonly string[] => [
  ...Object.keys(set),
  ...clear,
];

// One entry per item for a list, as for an extracted value. A corrected entity name
// carries the entity it was resolved to next to the mark of the correction.
const manualEntry = (
  name: string,
  value: unknown,
  { entityNames }: SectionPatch,
  resolutions: EntityResolutions,
): unknown => {
  const names = ownValue(entityNames, name);
  const entries =
    names === undefined
      ? (Array.isArray(value) ? value : [value]).map(() => MANUAL_PROVENANCE)
      : names.map((entity) => ({ ...resolutions.get(mentionKey(entity)), ...MANUAL_PROVENANCE }));
  return Array.isArray(value) ? entries : entries[0];
};

const manualEntries = (patch: SectionPatch, resolutions: EntityResolutions): Values =>
  Object.fromEntries(
    Object.entries(patch.set).map(([name, value]) => [
      name,
      manualEntry(name, value, patch, resolutions),
    ]),
  );

const masked = (mask: MaskSensitive, values: Values): Values =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, maskDeep(mask)(value)]));

const fitsField = (type: RegisteredType | undefined, name: string, value: unknown): boolean => {
  const definition = type === undefined ? undefined : ownValue(type.fields, name);
  return (
    definition !== undefined &&
    validateDocumentFields({ fields: { [name]: definition } }, { [name]: value }).ok
  );
};

interface MovedFields {
  readonly fields: Values;
  readonly extra: Values;
}

// Nothing is lost on a change of type. A value of the old type stays a field when the
// new type has a field of that name it is valid for, and goes to `extra` otherwise. Its
// provenance and its manual mark stay with it under its name: the re-extraction keeps a
// manual value wherever it is.
const moveFields = (stored: PipelineDocument, type: RegisteredType | undefined): MovedFields => {
  const entries = Object.entries(stored.fields);
  return {
    fields: Object.fromEntries(entries.filter(([name, value]) => fitsField(type, name, value))),
    extra: {
      ...stored.extra,
      ...Object.fromEntries(entries.filter(([name, value]) => !fitsField(type, name, value))),
    },
  };
};

// Correcting the type, the core or the fields is the review of a document flagged for
// one; a correction of the `private` flag alone, or of nothing, says nothing of its values.
const statusAfter = (stored: PipelineDocument, correction: Correction, touched: number) =>
  stored.status === 'needs_review' && (correction.typeGiven || touched > 0)
    ? ('indexed' as const)
    : stored.status;

/**
 * What a correction makes of a document. A corrected field is recorded in
 * `manual_fields`, cleared ones included, so no extraction writes it again.
 *
 * A change of type owes an extraction for the new type. Until one succeeds the document
 * carries no `schema_version` and no `confidence`: it is behind its type for
 * consolidation, unvouched for the review, and `process_document` extracts it again.
 */
export const applyCorrection = (stored: PipelineDocument, correction: Correction) => {
  const { type, typeGiven, typeChanged, core, fields, resolutions, maskSensitive } = correction;
  const kept = typeChanged ? moveFields(stored, type) : stored;
  const touched = [...namesOf(core), ...namesOf(fields)];
  const pipeline = readPipelineProvenance(stored.provenance);
  return {
    typeId: type?.id ?? null,
    schemaVersion: typeChanged ? null : stored.schemaVersion,
    confidence: typeChanged ? null : stored.confidence,
    core: { ...omit(stored.core, namesOf(core)), ...masked(maskSensitive, core.set) },
    fields: { ...omit(kept.fields, namesOf(fields)), ...masked(maskSensitive, fields.set) },
    extra: omit(kept.extra, namesOf(fields)),
    provenance: {
      ...omit(stored.provenance, touched),
      ...manualEntries(core, resolutions),
      ...manualEntries(fields, resolutions),
      [PIPELINE_PROVENANCE_KEY]: typeGiven ? { ...pipeline, type: MANUAL_PROVENANCE } : pipeline,
    },
    manualFields: [
      ...new Set([...stored.manualFields, ...touched, ...(typeGiven ? [MANUAL_TYPE_FIELD] : [])]),
    ],
    private: correction.private ?? stored.private,
    status: statusAfter(stored, correction, touched.length),
  };
};
