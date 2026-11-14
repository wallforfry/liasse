import type { z } from 'zod';
import { MAX_ENUM_VALUES } from '../domain/limits.ts';
import { fieldValueSchema, type ScalarFieldDefinition } from '../registry/primitives.ts';
import { err, ok, type Result } from '../registry/result.ts';

// Validates one value a query compares with a field. The failure says what was expected.
export type LiteralCheck = (raw: unknown) => Result<unknown, string>;

export const checkBySchema =
  (schema: z.ZodType): LiteralCheck =>
  (raw) => {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? ok(parsed.data)
      : err(parsed.error.issues.map(({ message }) => message).join('; '));
  };

// The language enum of the core has more values than a type schema may list, so an enum
// is checked against its values directly instead of through its value schema, and the
// values an error names are capped.
const checkByValues =
  (values: readonly string[]): LiteralCheck =>
  (raw) =>
    typeof raw === 'string' && values.includes(raw)
      ? ok(raw)
      : err(
          `expected one of: ${values.slice(0, MAX_ENUM_VALUES).join(', ')}${values.length > MAX_ENUM_VALUES ? ', ...' : ''}`,
        );

export const checkByDefinition = (definition: ScalarFieldDefinition): LiteralCheck =>
  definition.type === 'enum'
    ? checkByValues(definition.values)
    : checkBySchema(fieldValueSchema(definition));

export const nothingCompares: LiteralCheck = () => err('no value compares with this field');
