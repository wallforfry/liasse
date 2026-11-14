import { z } from 'zod';
import { keyDateSchema, languageCodeSchema } from '../domain/values.ts';
import { CORE_FIELDS, KEY_DATES_FIELD } from './core-fields.ts';
import type { TypeFields } from './fields.ts';
import { isPlainRecord, ownProperties } from './own.ts';
import {
  fieldValueSchema,
  untypedValueSchema,
  unwrapped,
  type ValueWrapper,
} from './primitives.ts';

type Shape = Readonly<Record<string, z.ZodType>>;

const closedObject = (shape: Shape) => z.preprocess(ownProperties, z.strictObject(shape));

// Every field is optional: a document only carries the values that were found in it.
const shapeOf = (fields: TypeFields, wrap: ValueWrapper): Shape =>
  Object.fromEntries(
    Object.entries(fields).map(([name, definition]) => [
      name,
      fieldValueSchema(definition, wrap).optional(),
    ]),
  );

export const valueSchemaForFields = (fields: TypeFields, wrap: ValueWrapper = unwrapped) =>
  closedObject(shapeOf(fields, wrap));

const { language: _language, ...coreFieldsWithinLimits } = CORE_FIELDS;

// The language enum has more values than a type schema may list, so its value schema is
// built directly instead of going through its definition.
export const coreValueSchema = (wrap: ValueWrapper = unwrapped) =>
  closedObject({
    ...shapeOf(coreFieldsWithinLimits, wrap),
    language: wrap(languageCodeSchema).optional(),
    [KEY_DATES_FIELD]: z.array(wrap(keyDateSchema)).optional(),
  });

// Zod's record schema leaves a key named `__proto__` out of its result without a word,
// so that key is refused before the record sees it.
const hasNoPrototypeKey = (input: unknown): boolean =>
  !isPlainRecord(input) || !Object.hasOwn(input, '__proto__');

export const extraValueSchema = (wrap: ValueWrapper = unwrapped) =>
  z
    .custom<unknown>(hasNoPrototypeKey, 'The key "__proto__" is not allowed')
    .pipe(z.record(z.string().min(1), untypedValueSchema(wrap)));
