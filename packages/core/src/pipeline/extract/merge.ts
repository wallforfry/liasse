import { isDeepStrictEqual } from 'node:util';
import { ownValue } from '@liasse/contract/registry';
import {
  MANUAL_TYPE_FIELD,
  PIPELINE_PROVENANCE_KEY,
  readPipelineProvenance,
} from '../../domain/provenance.ts';
import { CORE_FIELD_NAMES } from '../../registry/core-fields.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
import { documentConfidence, meanConfidence, typeConfidence } from '../confidence.ts';
import type { PipelineDocument } from '../document.ts';
import type { ExtractedDocument } from './interpret.ts';

type Values = Readonly<Record<string, unknown>>;

export interface MergeOptions {
  readonly type: RegisteredType | undefined;
  readonly truncated: boolean;
  readonly model: string;
  /** Re-extraction: a value that did not change keeps the provenance it had. */
  readonly keepProvenanceOfUnchanged: boolean;
}

export interface MergedDocument {
  readonly core: Values;
  readonly fields: Values;
  readonly extra: Values;
  readonly provenance: Values;
  readonly title: string;
  readonly summary: string | null;
  readonly confidence: number;
}

const pick = (record: Values, names: readonly string[]): Values =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = ownValue(record, name);
      return value === undefined ? [] : [[name, value] as const];
    }),
  );

const meanOf = (values: readonly number[]): readonly number[] => {
  const mean = meanConfidence(values);
  return mean === null ? [] : [mean];
};

const omit = (record: Values, names: readonly string[]): Values =>
  Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name)));

// A manual correction takes precedence: the stored value of a corrected field stands,
// and a field a person cleared stays empty.
const withManual = (fresh: Values, stored: Values, manual: readonly string[]): Values => ({
  ...omit(fresh, manual),
  ...pick(stored, manual),
});

const provenanceOf = (
  values: Values,
  storedValues: Values,
  fresh: Values,
  stored: Values,
  keepUnchanged: (name: string) => boolean,
): Values =>
  Object.fromEntries(
    Object.keys(values).flatMap((name) => {
      const previous = ownValue(stored, name);
      const unchanged =
        previous !== undefined &&
        keepUnchanged(name) &&
        isDeepStrictEqual(ownValue(values, name), ownValue(storedValues, name));
      const entry = unchanged ? previous : ownValue(fresh, name);
      return entry === undefined ? [] : [[name, entry] as const];
    }),
  );

export const mergeWithStored = (
  stored: PipelineDocument,
  fresh: ExtractedDocument,
  { type, truncated, model, keepProvenanceOfUnchanged }: MergeOptions,
): MergedDocument => {
  const manual = stored.manualFields.filter((name) => name !== MANUAL_TYPE_FIELD);
  const manualCore = manual.filter((name) => CORE_FIELD_NAMES.includes(name));
  const manualFields = manual.filter((name) => ownValue(type?.fields ?? {}, name) !== undefined);
  // A manual value in `extra` is one a person set on a field of an earlier type.
  const manualExtra = manual.filter(
    (name) => !manualCore.includes(name) && !manualFields.includes(name),
  );
  const core = withManual(fresh.core, stored.core, manualCore);
  const fields = withManual(fresh.fields, stored.fields, manualFields);
  const extra = withManual(fresh.extra, stored.extra, manualExtra);
  const keep = (name: string): boolean => keepProvenanceOfUnchanged || manual.includes(name);
  const entries = (values: Values, storedValues: Values): Values =>
    provenanceOf(values, storedValues, fresh.provenance, stored.provenance, keep);
  const pipeline = readPipelineProvenance(stored.provenance);
  // One entry per filled core field: a list field such as `key_dates` weighs by the mean
  // of its items. A value that was rejected counts as one field at 0.
  const coreConfidences = [
    ...Object.keys(core).flatMap((name) =>
      manualCore.includes(name) ? [1] : meanOf(ownValue(fresh.coreConfidences, name) ?? []),
    ),
    ...Array.from({ length: fresh.rejectedCore }, () => 0),
  ];
  return {
    core,
    fields,
    extra,
    provenance: {
      ...entries(extra, stored.extra),
      ...entries(fields, stored.fields),
      ...entries(core, stored.core),
      [PIPELINE_PROVENANCE_KEY]: {
        ...pipeline,
        extraction: {
          model,
          schema_version: type?.version ?? null,
          truncated,
          rejected_values: fresh.rejected,
          dropped_identifiers: fresh.droppedIdentifiers,
        },
      },
    },
    title: fresh.title ?? stored.title ?? stored.originalName,
    summary: fresh.summary ?? stored.summary,
    confidence: documentConfidence(typeConfidence(pipeline.type), coreConfidences),
  };
};
