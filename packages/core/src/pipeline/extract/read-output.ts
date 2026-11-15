import { languageCodeSchema } from '@liasse/contract/domain';
import { ownValue } from '@liasse/contract/registry';
import type { z } from 'zod';
import type { TypeFields } from '../../registry/fields.ts';
import { fieldNameViolations } from '../../registry/naming.ts';
import { validateDocumentFields } from '../../registry/validate-document-fields.ts';
import { coreValueSchema, extraValueSchema } from '../../registry/values.ts';
import { type Evidenced, evidencedSchema, type ExtractionOutput } from './extraction-schema.ts';
import type { QuoteIndex } from './quotes.ts';
import { quoteSupports, type SupportKind } from './support.ts';
import { coreKinds, type KindOf, kindOfShape, typeKinds } from './value-kinds.ts';

// `extra` feeds field promotion: a key is kept only if it could become a field name.
export const MAX_EXTRA_KEYS = 50;

export type VerifiedValue = Evidenced;

/** One verified value, or the verified items of a list field. */
export type Reading = VerifiedValue | readonly VerifiedValue[];
export type Readings = Readonly<Record<string, Reading>>;

export const isListReading = (reading: Reading): reading is readonly VerifiedValue[] =>
  Array.isArray(reading);

export const plainValue = (reading: Reading): unknown =>
  isListReading(reading) ? reading.map(({ value }) => value) : reading.value;

export interface SectionReading {
  readonly readings: Readings;
  /** Values the model returned that were dropped. */
  readonly rejected: number;
}

/** What a value is verified against: the pages the model was given, and their language. */
export interface Evidence {
  readonly quotes: QuoteIndex;
  readonly language: string | undefined;
}

// A list in `extra` has one quote for all its items: each of them must be stated.
const supported = (
  value: unknown,
  quote: string,
  kind: (value: unknown) => SupportKind,
  language: string | undefined,
): boolean => {
  const items: readonly unknown[] = Array.isArray(value) ? value : [value];
  return (
    items.length > 0 && items.every((item) => quoteSupports(kind(item), item, quote, language))
  );
};

// Spec: a value without a quote verifiable in the text is rejected. The quote must stand
// in the text, and state the value by the rule of its kind. The page kept is the one the
// quote stands on.
const verify = (
  raw: unknown,
  kind: (value: unknown) => SupportKind,
  { quotes, language }: Evidence,
): VerifiedValue | undefined => {
  const evidenced = evidencedSchema.safeParse(raw);
  if (!evidenced.success) return undefined;
  const { value, quote } = evidenced.data;
  const page = quotes.locate(quote, evidenced.data.page);
  return page === undefined || !supported(value, quote, kind, language)
    ? undefined
    : { ...evidenced.data, page };
};

interface FieldReading {
  readonly name: string;
  readonly reading?: Reading;
  readonly rejected: number;
}

const readField = (
  name: string,
  raw: unknown,
  kindOf: KindOf,
  evidence: Evidence,
): FieldReading => {
  const kind = (value: unknown) => kindOf(name, value);
  if (!Array.isArray(raw)) {
    const verified = verify(raw, kind, evidence);
    return verified === undefined
      ? { name, rejected: 1 }
      : { name, reading: verified, rejected: 0 };
  }
  const verified = raw.flatMap((item: unknown) => verify(item, kind, evidence) ?? []);
  return {
    name,
    ...(verified.length === 0 ? {} : { reading: verified }),
    rejected: raw.length - verified.length,
  };
};

type InvalidNames = (values: Readonly<Record<string, unknown>>) => readonly string[] | 'all';

const invalidBySchema =
  (schema: z.ZodType): InvalidNames =>
  (values) => {
    const parsed = schema.safeParse(values);
    if (parsed.success) return [];
    const names = parsed.error.issues.map(({ path }) => path[0]);
    return names.every((name) => typeof name === 'string') ? names : 'all';
  };

const invalidForType =
  (fields: TypeFields): InvalidNames =>
  (values) => {
    const validated = validateDocumentFields({ fields }, values);
    if (validated.ok) return [];
    const names = validated.error.map(({ field }) => field);
    return names.every((name) => name !== undefined) ? names : 'all';
  };

// The registry has the last word on a value: whatever it refuses is dropped, alone.
const readSection = (
  raw: Readonly<Record<string, unknown>>,
  kindOf: KindOf,
  evidence: Evidence,
  invalidNames: InvalidNames,
): SectionReading => {
  const fields = Object.entries(raw).map(([name, value]) =>
    readField(name, value, kindOf, evidence),
  );
  const read = fields.flatMap(({ name, reading }) =>
    reading === undefined ? [] : [[name, reading] as const],
  );
  const invalid = invalidNames(
    Object.fromEntries(read.map(([name, reading]) => [name, plainValue(reading)])),
  );
  const valid = read.filter(([name]) => invalid !== 'all' && !invalid.includes(name));
  return {
    readings: Object.fromEntries(valid),
    rejected:
      fields.reduce((total, { rejected }) => total + rejected, 0) + (read.length - valid.length),
  };
};

// A key that names a core field or a field of the type is a value put in the wrong
// place, and one that is not snake_case could never be promoted to a field.
const acceptableExtra = (
  extra: Readonly<Record<string, unknown>>,
  typeFields: TypeFields,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(extra)
      .filter(
        ([key]) => fieldNameViolations(key).length === 0 && ownValue(typeFields, key) === undefined,
      )
      .slice(0, MAX_EXTRA_KEYS),
  );

export interface OutputReading {
  readonly core: SectionReading;
  readonly fields: SectionReading;
  readonly extra: SectionReading;
}

/** The language the model gave the document, when it is a language code. */
export const languageOf = (output: ExtractionOutput): string | undefined =>
  languageCodeSchema.safeParse(evidencedSchema.safeParse(output.core.language).data?.value).data;

export const readOutput = (
  output: ExtractionOutput,
  typeFields: TypeFields,
  evidence: Evidence,
): OutputReading => {
  const extra = acceptableExtra(output.extra, typeFields);
  const read = readSection(extra, kindOfShape, evidence, invalidBySchema(extraValueSchema()));
  return {
    core: readSection(output.core, coreKinds, evidence, invalidBySchema(coreValueSchema())),
    fields: readSection(output.fields, typeKinds(typeFields), evidence, invalidForType(typeFields)),
    extra: {
      ...read,
      rejected: read.rejected + (Object.keys(output.extra).length - Object.keys(extra).length),
    },
  };
};
