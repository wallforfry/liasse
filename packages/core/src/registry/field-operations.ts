import { isDeepStrictEqual } from 'node:util';
import type { RegistryReadContext } from './context.ts';
import {
  fieldFailure,
  invalidFields,
  type RegistryError,
  typeMerged,
  typeNotFound,
} from './errors.ts';
import { checkField, checkTypeFields, type TypeFields } from './fields.ts';
import { ownValue } from './own.ts';
import type { FieldDefinition } from './primitives.ts';
import { err, ok, type Result } from './result.ts';
import {
  findTypeById,
  type RegisteredType,
  updateTypeFields,
  withRegistryLock,
} from './type-store.ts';

type FieldChange = (fields: TypeFields) => Result<Readonly<Record<string, unknown>>, RegistryError>;

// These are registry writes and nothing more: they record no `type_changes` row and queue
// no re-extraction. Documents keep the `schema_version` they were extracted with.
const changeFields = (
  typeId: string,
  { db }: RegistryReadContext,
  change: FieldChange,
): Promise<Result<RegisteredType, RegistryError>> =>
  withRegistryLock(db, async (tx) => {
    const type = await findTypeById(tx, typeId);
    if (type === undefined) return err(typeNotFound(typeId));
    if (type.status === 'merged') return err(typeMerged(type.slug));
    const changed = change(type.fields);
    if (!changed.ok) return changed;
    const fields = checkTypeFields(changed.value);
    if (!fields.ok) return err(invalidFields(fields.error));
    return ok(await updateTypeFields(tx, type, fields.value));
  });

const notFound = (name: string) =>
  fieldFailure('field_not_found', name, `The type has no field "${name}".`);

const exists = (name: string) =>
  fieldFailure('field_exists', name, `The type already has a field "${name}".`);

const checkDefinition = (
  name: string,
  definition: unknown,
): Result<FieldDefinition, RegistryError> => {
  const checked = checkField(name, definition);
  return checked.ok ? ok(checked.value[1]) : err(invalidFields(checked.error));
};

const without = (fields: TypeFields, name: string): TypeFields =>
  Object.fromEntries(Object.entries(fields).filter(([field]) => field !== name));

export const addField = (
  typeId: string,
  name: string,
  definition: unknown,
  context: RegistryReadContext,
): Promise<Result<RegisteredType, RegistryError>> =>
  changeFields(typeId, context, (fields) => {
    const proposed = checkDefinition(name, definition);
    if (!proposed.ok) return proposed;
    const existing = ownValue(fields, name);
    if (existing === undefined) return ok({ ...fields, [name]: proposed.value });
    return isDeepStrictEqual(existing, proposed.value)
      ? err(exists(name))
      : err({
          code: 'primitive_conflict',
          message: `The type already has a field "${name}" with another definition.`,
          field: name,
          existing,
          proposed: proposed.value,
        });
  });

export const renameField = (
  typeId: string,
  from: string,
  to: string,
  context: RegistryReadContext,
): Promise<Result<RegisteredType, RegistryError>> =>
  changeFields(typeId, context, (fields) => {
    const definition = ownValue(fields, from);
    if (definition === undefined) return err(notFound(from));
    if (ownValue(fields, to) !== undefined) return err(exists(to));
    return ok({ ...without(fields, from), [to]: definition });
  });

export const retypeField = (
  typeId: string,
  name: string,
  definition: unknown,
  context: RegistryReadContext,
): Promise<Result<RegisteredType, RegistryError>> =>
  changeFields(typeId, context, (fields) => {
    const existing = ownValue(fields, name);
    if (existing === undefined) return err(notFound(name));
    const proposed = checkDefinition(name, definition);
    if (!proposed.ok) return proposed;
    return isDeepStrictEqual(existing, proposed.value)
      ? err(
          fieldFailure(
            'field_unchanged',
            name,
            `The field "${name}" already has this definition; the version stays the same.`,
          ),
        )
      : ok({ ...fields, [name]: proposed.value });
  });

export const removeField = (
  typeId: string,
  name: string,
  context: RegistryReadContext,
): Promise<Result<RegisteredType, RegistryError>> =>
  changeFields(typeId, context, (fields) =>
    ownValue(fields, name) === undefined ? err(notFound(name)) : ok(without(fields, name)),
  );
