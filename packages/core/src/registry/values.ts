import { z } from 'zod';
import { keyDateSchema, languageCodeSchema } from '../domain/values.ts';
import { CORE_FIELDS, KEY_DATES_FIELD } from './core-fields.ts';
import type { TypeFields } from './fields.ts';
import { fieldValueSchema, untypedValueSchema } from './primitives.ts';

// Decorates the schema of one value, for instance to pair it with the page, the quote and
// the confidence it was extracted with. Every generator below applies it to each value and
// to nothing else, so the primitives are never described twice.
export type ValueWrapper = (value: z.ZodType) => z.ZodType;

const unwrapped: ValueWrapper = (value) => value;

// Every field is optional: a document only carries the values that were found in it.
export const valueSchemaForFields = (fields: TypeFields, wrap: ValueWrapper = unwrapped) =>
  z.strictObject(
    Object.fromEntries(
      Object.entries(fields).map(([name, definition]) => [
        name,
        wrap(fieldValueSchema(definition)).optional(),
      ]),
    ),
  );

const { language: _language, ...coreFieldsWithinLimits } = CORE_FIELDS;

// The language enum has more values than a type schema may list, so its value schema is
// built directly instead of going through its definition.
export const coreValueSchema = (wrap: ValueWrapper = unwrapped) =>
  valueSchemaForFields(coreFieldsWithinLimits, wrap).extend({
    language: wrap(languageCodeSchema).optional(),
    [KEY_DATES_FIELD]: z.array(wrap(keyDateSchema)).optional(),
  });

export const extraValueSchema = (wrap: ValueWrapper = unwrapped) =>
  z.record(z.string().min(1), wrap(untypedValueSchema));
