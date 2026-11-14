import type { z } from 'zod';
import type { TypeFields } from '../../registry/fields.ts';
import { fieldNameViolations } from '../../registry/naming.ts';
import { ownValue } from '../../registry/own.ts';
import { validateDocumentFields } from '../../registry/validate-document-fields.ts';
import { coreValueSchema, extraValueSchema } from '../../registry/values.ts';
import { isConsistentWithQuote } from './consistency.ts';
import { type Evidenced, evidencedSchema, type ExtractionOutput } from './extraction-schema.ts';
import type { QuoteIndex } from './quotes.ts';

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

// Spec: a value without a quote verifiable in the text is rejected. The page kept is
// the one the quote stands on.
const verify = (raw: unknown, quotes: QuoteIndex): VerifiedValue | undefined => {
  const evidenced = evidencedSchema.safeParse(raw);
  if (!evidenced.success) return undefined;
  const page = quotes.locate(evidenced.data.quote, evidenced.data.page);
  return page === undefined || !isConsistentWithQuote(evidenced.data.value, evidenced.data.quote)
    ? undefined
    : { ...evidenced.data, page };
};

interface FieldReading {
  readonly name: string;
  readonly reading?: Reading;
  readonly rejected: number;
}

const readField = (name: string, raw: unknown, quotes: QuoteIndex): FieldReading => {
  if (!Array.isArray(raw)) {
    const verified = verify(raw, quotes);
    return verified === undefined
      ? { name, rejected: 1 }
      : { name, reading: verified, rejected: 0 };
  }
  const verified = raw.flatMap((item: unknown) => verify(item, quotes) ?? []);
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
  quotes: QuoteIndex,
  invalidNames: InvalidNames,
): SectionReading => {
  const fields = Object.entries(raw).map(([name, value]) => readField(name, value, quotes));
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

export const readOutput = (
  output: ExtractionOutput,
  typeFields: TypeFields,
  quotes: QuoteIndex,
): OutputReading => {
  const extra = acceptableExtra(output.extra, typeFields);
  const read = readSection(extra, quotes, invalidBySchema(extraValueSchema()));
  return {
    core: readSection(output.core, quotes, invalidBySchema(coreValueSchema())),
    fields: readSection(output.fields, quotes, invalidForType(typeFields)),
    extra: {
      ...read,
      rejected: read.rejected + (Object.keys(output.extra).length - Object.keys(extra).length),
    },
  };
};
