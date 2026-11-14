import { z } from 'zod';
import type { JsonObject } from '../db/columns.ts';
import { checkTypeFields, type FieldIssue, type TypeFields } from './fields.ts';
import { isPlainRecord, ownValue } from './own.ts';
import { valueSchemaForFields } from './values.ts';

// JSON Schema ignores a keyword it does not know, so the definition travels with the
// property it produced and the schema reads back without guessing.
export const FIELD_ANNOTATION = 'x-liasse-field';

export class InvalidTypeSchemaError extends Error {
  override readonly name = 'InvalidTypeSchemaError';
  readonly issues: readonly FieldIssue[];

  constructor(issues: readonly FieldIssue[]) {
    super(`The type schema is not valid: ${issues.map(({ message }) => message).join(' ')}`);
    this.issues = issues;
  }
}

const storedSchema = z.looseObject({
  type: z.literal('object'),
  additionalProperties: z.literal(false),
  properties: z.custom<Readonly<Record<string, unknown>>>(isPlainRecord),
});

const renderedProperty = (
  properties: Readonly<Record<string, unknown>>,
  name: string,
): Readonly<Record<string, unknown>> => {
  const property = ownValue(properties, name);
  return isPlainRecord(property) ? property : {};
};

const validFields = (input: unknown): TypeFields => {
  const checked = checkTypeFields(input);
  if (!checked.ok) throw new InvalidTypeSchemaError(checked.error);
  return checked.value;
};

// The only producer of `doc_types.schema`. It takes raw input and validates it itself, so
// a caller cannot hand it fields that skipped validation.
export const renderTypeSchema = (input: unknown): JsonObject => {
  const fields = validFields(input);
  const schema = storedSchema.parse(z.toJSONSchema(valueSchemaForFields(fields)));
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(fields).map(([name, definition]) => [
        name,
        { ...renderedProperty(schema.properties, name), [FIELD_ANNOTATION]: definition },
      ]),
    ),
  };
};

// Only the annotations are read back. The other keywords are a rendering whose exact
// text follows the Zod version, so comparing them would reject rows written before an upgrade.
export const parseTypeSchema = (stored: unknown): TypeFields => {
  const schema = storedSchema.safeParse(stored);
  if (!schema.success) {
    throw new InvalidTypeSchemaError([
      {
        rule: 'not_an_object',
        message:
          'Expected a JSON Schema object with "properties" and "additionalProperties": false.',
      },
    ]);
  }
  return validFields(
    Object.fromEntries(
      Object.entries(schema.data.properties).map(([name, property]) => [
        name,
        isPlainRecord(property) ? property[FIELD_ANNOTATION] : undefined,
      ]),
    ),
  );
};
