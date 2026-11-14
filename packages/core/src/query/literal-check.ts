import type { z } from 'zod';
import { MAX_ENUM_VALUES } from '../domain/limits.ts';
import { fieldValueSchema, type ScalarFieldDefinition } from '../registry/primitives.ts';
import { err, ok, type Result } from '../registry/result.ts';
import { cut } from './errors.ts';

export interface LiteralRefusal {
  // What was expected, in words of Liasse only.
  readonly reason: string;
  // The values an enum takes. A type schema is proposed from the text of documents, so
  // they are untrusted content: they are cut, and never part of a sentence.
  readonly allowed?: readonly string[];
}

// Validates one value a query compares with a field.
export type LiteralCheck = (raw: unknown) => Result<unknown, LiteralRefusal>;

export const checkBySchema =
  (schema: z.ZodType): LiteralCheck =>
  (raw) => {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? ok(parsed.data)
      : err({ reason: parsed.error.issues.map(({ message }) => message).join('; ') });
  };

// The language enum of the core has more values than a type schema may list, so an enum
// is checked against its values directly instead of through its value schema, and the
// values an error carries are capped.
const checkByValues = (values: readonly string[]): LiteralCheck => {
  const listed = values.slice(0, MAX_ENUM_VALUES).map(cut);
  const reason = `expected one of the values in "allowed"${values.length > listed.length ? `, the first ${String(listed.length)} of ${String(values.length)}` : ''}`;
  return (raw) =>
    typeof raw === 'string' && values.includes(raw) ? ok(raw) : err({ reason, allowed: listed });
};

export const checkByDefinition = (definition: ScalarFieldDefinition): LiteralCheck =>
  definition.type === 'enum'
    ? checkByValues(definition.values)
    : checkBySchema(fieldValueSchema(definition));

export const nothingCompares: LiteralCheck = () =>
  err({ reason: 'no value compares with this field' });
