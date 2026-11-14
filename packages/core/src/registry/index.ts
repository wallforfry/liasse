export type { RegistryContext, RegistryReadContext, RegistryWriteContext } from './context.ts';
export { CORE_FIELD_NAMES, CORE_FIELDS, KEY_DATES_FIELD } from './core-fields.ts';
export { createType, type CreateTypeInput } from './create-type.ts';
export type {
  FieldFailure,
  InvalidAlias,
  InvalidFields,
  InvalidSlug,
  NameTaken,
  PrimitiveConflict,
  QuotaExceeded,
  RegistryError,
  RegistryErrorCode,
} from './errors.ts';
export { addField, removeField, renameField, retypeField } from './field-operations.ts';
export { type FieldPath, fieldPaths } from './field-paths.ts';
export { checkTypeFields, type FieldIssue, type FieldRule, type TypeFields } from './fields.ts';
export { addAlias, markMerged, setStatus } from './lifecycle.ts';
export {
  aliasViolations,
  fieldNameViolations,
  type KnownEntityName,
  MONTH_WORDS,
  NAMING_RULES,
  type NamingRule,
  type NamingViolation,
  type SlugContext,
  slugViolations,
} from './naming.ts';
export {
  FIELD_PRIMITIVES,
  type FieldDefinition,
  fieldDefinitionSchema,
  type FieldPrimitive,
  fieldValueSchema,
  type ScalarFieldDefinition,
  type ValueWrapper,
} from './primitives.ts';
export {
  type ClosestType,
  closestTypes,
  DEFAULT_CLOSEST_TYPES,
  EXAMPLE_TITLES_PER_TYPE,
  type ListedType,
  listTypes,
  type ListTypesOptions,
  resolveType,
} from './read-types.ts';
export type { Result } from './result.ts';
export {
  FIELD_ANNOTATION,
  InvalidTypeSchemaError,
  parseTypeSchema,
  renderTypeSchema,
} from './stored-schema.ts';
export type { RegisteredType } from './type-store.ts';
export { type FieldValueError, validateDocumentFields } from './validate-document-fields.ts';
export { coreValueSchema, extraValueSchema, valueSchemaForFields } from './values.ts';
