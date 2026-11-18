// What a change of the type registry is refused with. Creating a type through the API
// answers these codes as they are.
export const REGISTRY_ERROR_CODES = [
  'invalid_slug',
  'invalid_alias',
  'invalid_fields',
  'name_taken',
  'quota_exceeded',
  'primitive_conflict',
  'field_exists',
  'field_not_found',
  'field_unchanged',
  'invalid_description',
  'parent_not_found',
  'hierarchy_too_deep',
  'type_not_found',
  'type_merged',
  'invalid_status',
  'invalid_merge',
] as const;
export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

export const isRegistryErrorCode = (code: string): code is RegistryErrorCode =>
  REGISTRY_ERROR_CODES.some((listed) => listed === code);
