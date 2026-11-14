import {
  MANUAL_PROVENANCE,
  MANUAL_TYPE_FIELD,
  PIPELINE_PROVENANCE_KEY,
  readPipelineProvenance,
} from '../../domain/provenance.ts';
import { ownValue } from '../../registry/own.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
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

/**
 * What a correction makes of a document. A corrected field is recorded in
 * `manual_fields`, cleared ones included, so no extraction writes it again.
 *
 * On a change of type the fields of the old type are dropped, with their provenance and
 * their manual marks: their names mean nothing in the new type, and the re-extraction
 * the change queues reads the document again for the fields of the new one.
 */
export const applyCorrection = (stored: PipelineDocument, correction: Correction) => {
  const { type, typeGiven, typeChanged, core, fields, resolutions, maskSensitive } = correction;
  const leaving = typeChanged ? Object.keys(stored.fields) : [];
  const touched = [...namesOf(core), ...namesOf(fields)];
  const pipeline = readPipelineProvenance(stored.provenance);
  return {
    typeId: type?.id ?? null,
    schemaVersion: typeChanged ? (type?.version ?? null) : stored.schemaVersion,
    core: { ...omit(stored.core, namesOf(core)), ...masked(maskSensitive, core.set) },
    fields: {
      ...omit(stored.fields, [...leaving, ...namesOf(fields)]),
      ...masked(maskSensitive, fields.set),
    },
    provenance: {
      ...omit(stored.provenance, [...leaving, ...touched]),
      ...manualEntries(core, resolutions),
      ...manualEntries(fields, resolutions),
      [PIPELINE_PROVENANCE_KEY]: typeGiven ? { ...pipeline, type: MANUAL_PROVENANCE } : pipeline,
    },
    manualFields: [
      ...new Set([
        ...stored.manualFields.filter((name) => !leaving.includes(name)),
        ...touched,
        ...(typeGiven ? [MANUAL_TYPE_FIELD] : []),
      ]),
    ],
    private: correction.private ?? stored.private,
    // Correcting a document flagged for review is the review.
    status: stored.status === 'needs_review' ? ('indexed' as const) : stored.status,
  };
};
