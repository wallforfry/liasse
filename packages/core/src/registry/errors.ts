import type { FieldDefinition, RegistryErrorCode } from '@liasse/contract/registry';
import type { FieldIssue } from './fields.ts';
import type { NamingViolation } from './naming.ts';

interface Failure<Code extends RegistryErrorCode> {
  readonly code: Code;
  // Complete on its own: it is shown as is to the model or the agent that made the request.
  readonly message: string;
}

export interface InvalidSlug extends Failure<'invalid_slug'> {
  readonly slug: string;
  readonly violations: readonly NamingViolation[];
}

export interface InvalidAlias extends Failure<'invalid_alias'> {
  readonly alias: string;
  readonly violations: readonly NamingViolation[];
}

export interface InvalidFields extends Failure<'invalid_fields'> {
  readonly issues: readonly FieldIssue[];
}

export interface NameTaken extends Failure<'name_taken'> {
  readonly name: string;
  readonly heldBy: string;
}

export interface PrimitiveConflict extends Failure<'primitive_conflict'> {
  readonly field: string;
  readonly existing: FieldDefinition;
  readonly proposed: FieldDefinition;
}

export interface FieldFailure<Code extends RegistryErrorCode> extends Failure<Code> {
  readonly field: string;
}

export type RegistryError =
  | InvalidSlug
  | InvalidAlias
  | InvalidFields
  | NameTaken
  | PrimitiveConflict
  | FieldFailure<'field_exists'>
  | FieldFailure<'field_not_found'>
  | FieldFailure<'field_unchanged'>
  | Failure<'invalid_description'>
  | Failure<'parent_not_found'>
  | Failure<'hierarchy_too_deep'>
  | Failure<'type_not_found'>
  | Failure<'type_merged'>
  | Failure<'invalid_status'>
  | Failure<'invalid_merge'>;

const joined = (items: readonly { readonly message: string }[]): string =>
  items.map(({ message }) => message).join(' ');

export const invalidSlug = (slug: string, violations: readonly NamingViolation[]): InvalidSlug => ({
  code: 'invalid_slug',
  message: joined(violations),
  slug,
  violations,
});

export const invalidAlias = (
  alias: string,
  violations: readonly NamingViolation[],
): InvalidAlias => ({ code: 'invalid_alias', message: joined(violations), alias, violations });

export const invalidFields = (issues: readonly FieldIssue[]): InvalidFields => ({
  code: 'invalid_fields',
  message: joined(issues),
  issues,
});

export const nameTaken = (name: string, heldBy: string): NameTaken => ({
  code: 'name_taken',
  message:
    name === heldBy
      ? `A type with the slug "${name}" already exists.`
      : `"${name}" is already an alias of the type "${heldBy}".`,
  name,
  heldBy,
});

export const failure = <Code extends RegistryErrorCode>(
  code: Code,
  message: string,
): Failure<Code> => ({
  code,
  message,
});

export const fieldFailure = <Code extends RegistryErrorCode>(
  code: Code,
  field: string,
  message: string,
): FieldFailure<Code> => ({ code, field, message });

export const typeNotFound = (id: string) =>
  failure('type_not_found', `No type has the id "${id}".`);

export const typeMerged = (slug: string) =>
  failure(
    'type_merged',
    `The type "${slug}" is merged into another type and can no longer change.`,
  );
