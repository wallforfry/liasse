import { CORE_FIELDS, type FieldDefinition, ownValue } from '@liasse/contract/registry';
import type { ExtractedProvenance } from '../../domain/provenance.ts';
import type { TypeFields } from '../../registry/fields.ts';
import { type EntityResolutions, mentionKey } from './entities.ts';
import {
  isListReading,
  type OutputReading,
  type Readings,
  type SectionReading,
  type VerifiedValue,
} from './read-output.ts';
import { addRejections, type Rejections, rejectionsOf } from './rejections.ts';

export interface ExtractionTrace {
  readonly model: string;
  readonly schemaVersion: number | null;
}

type Definitions = Readonly<Record<string, FieldDefinition>>;

const isEntityField = (definition: FieldDefinition | undefined): boolean =>
  definition?.type === 'entity' ||
  (definition?.type === 'list' && definition.items.type === 'entity');

const itemsOf = (readings: Readings, name: string): readonly VerifiedValue[] => {
  const reading = ownValue(readings, name);
  if (reading === undefined) return [];
  return isListReading(reading) ? reading : [reading];
};

const entityNamesIn = (readings: Readings, definitions: Definitions): readonly string[] =>
  Object.keys(readings)
    .filter((name) => isEntityField(ownValue(definitions, name)))
    .flatMap((name) => itemsOf(readings, name))
    .flatMap(({ value }) => (typeof value === 'string' ? [value] : []));

/** The names of the entity-typed values, in the order of the output. */
export const entityNamesOf = (
  reading: OutputReading,
  typeFields: TypeFields,
): readonly string[] => [
  ...entityNamesIn(reading.core.readings, CORE_FIELDS),
  ...entityNamesIn(reading.fields.readings, typeFields),
];

export interface AssembledSection {
  readonly values: Readonly<Record<string, unknown>>;
  /** Keyed by field name; the entry of a list field is an array, one entry per item. */
  readonly provenance: Readonly<Record<string, unknown>>;
  /** The confidence the model gave each kept value, per field. */
  readonly confidences: Readonly<Record<string, readonly number[]>>;
  readonly rejected: Rejections;
}

interface Kept {
  readonly value: unknown;
  readonly entry: unknown;
  readonly confidence: number;
}

const extractedEntry = (
  { page, quote, confidence }: VerifiedValue,
  { model, schemaVersion }: ExtractionTrace,
): ExtractedProvenance => ({ model, schema_version: schemaVersion, confidence, page, quote });

// Spec: `core` and `fields` keep the name as extracted; the entity it designates is the
// provenance entry. A name that resolves to no entity is not kept.
const keep = (
  item: VerifiedValue,
  entity: boolean,
  trace: ExtractionTrace,
  resolutions: EntityResolutions,
): readonly Kept[] => {
  if (!entity) {
    return [{ value: item.value, entry: extractedEntry(item, trace), confidence: item.confidence }];
  }
  const resolution =
    typeof item.value === 'string' ? resolutions.get(mentionKey(item.value)) : undefined;
  return resolution === undefined
    ? []
    : [{ value: item.value, entry: resolution, confidence: item.confidence }];
};

export const assembleSection = (
  { readings, rejected }: SectionReading,
  definitions: Definitions,
  trace: ExtractionTrace,
  resolutions: EntityResolutions,
): AssembledSection => {
  const fields = Object.entries(readings).map(([name, reading]) => {
    const items = isListReading(reading) ? reading : [reading];
    const kept = items.flatMap((item) =>
      keep(item, isEntityField(ownValue(definitions, name)), trace, resolutions),
    );
    return { name, list: isListReading(reading), kept, dropped: items.length - kept.length };
  });
  const filled = fields.filter(({ kept }) => kept.length > 0);
  const collect = (pick: (kept: Kept) => unknown) =>
    Object.fromEntries(
      filled.map(({ name, list, kept }) => [name, list ? kept.map(pick) : kept.map(pick)[0]]),
    );
  return {
    values: collect(({ value }) => value),
    provenance: collect(({ entry }) => entry),
    confidences: Object.fromEntries(
      filled.map(({ name, kept }) => [name, kept.map(({ confidence }) => confidence)]),
    ),
    rejected: addRejections(
      rejected,
      rejectionsOf(fields.map(({ name, dropped }) => [name, dropped] as const)),
    ),
  };
};
