import type { z } from 'zod';
import type { TypeFields } from './fields.ts';
import { err, ok, type Result } from './result.ts';
import { valueSchemaForFields } from './values.ts';

export interface FieldValueError {
  // Absent when the fields as a whole are not an object.
  readonly field?: string;
  readonly code: 'unknown_field' | 'invalid_value';
  // Where the value is, from the field down: `period.end`, `tags.1`.
  readonly path: string;
  readonly message: string;
}

const invalidValue = (issue: z.core.$ZodIssue): FieldValueError => {
  const path = issue.path.map(String);
  const [field] = path;
  return {
    ...(field === undefined ? {} : { field }),
    code: 'invalid_value',
    path: path.join('.'),
    message: issue.message,
  };
};

const describeKnown = (known: readonly string[]): string =>
  known.length === 0 ? 'It defines no field.' : `Its fields are: ${known.join(', ')}.`;

const toErrors =
  (known: readonly string[]) =>
  (issue: z.core.$ZodIssue): readonly FieldValueError[] =>
    issue.code === 'unrecognized_keys' && issue.path.length === 0
      ? issue.keys.map((field) => ({
          field,
          code: 'unknown_field',
          path: field,
          message: `The type has no field "${field}". ${describeKnown(known)}`,
        }))
      : [invalidValue(issue)];

export const validateDocumentFields = (
  type: { readonly fields: TypeFields },
  fields: unknown,
): Result<Readonly<Record<string, unknown>>, readonly FieldValueError[]> => {
  const parsed = valueSchemaForFields(type.fields).safeParse(fields);
  return parsed.success
    ? ok(parsed.data)
    : err(parsed.error.issues.flatMap(toErrors(Object.keys(type.fields))));
};
