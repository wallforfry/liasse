import { isDeepStrictEqual } from 'node:util';
import type { TypeFields } from '../registry/fields.ts';
import { addField, removeField, retypeField } from '../registry/field-operations.ts';
import { markMerged, setStatus } from '../registry/lifecycle.ts';
import { ownValue } from '../registry/own.ts';
import {
  findTypeById,
  type RegisteredType,
  type RegistryTransaction,
  withRegistryLock,
} from '../registry/type-store.ts';
import type { ChangeTransaction } from './change-store.ts';
import { ChangeRefusedError, orRefuse } from './refusal.ts';
import { moveDocuments } from './document-moves.ts';
import type {
  MergePayload,
  PromoteFieldPayload,
  RemoveFieldPayload,
  StabilizePayload,
} from './payloads.ts';

const liveType = async (tx: RegistryTransaction, id: string): Promise<RegisteredType> => {
  const type = await findTypeById(tx, id);
  if (type === undefined) {
    throw new ChangeRefusedError({
      code: 'type_not_found',
      message: `No type has the id "${id}".`,
    });
  }
  if (type.status === 'merged') {
    throw new ChangeRefusedError({
      code: 'type_merged',
      message: `The type "${type.slug}" was merged into another type.`,
    });
  }
  return type;
};

const renamesOf = (pairs: readonly (readonly [string, string | null])[]) =>
  new Map(pairs.flatMap(([from, to]) => (to === null || to === from ? [] : [[from, to] as const])));

/**
 * Moves the documents of the source to the target, with their values renamed by the
 * mapping, then merges the source into the target: its slug and aliases become aliases
 * of the target. Answers with the number of re-extractions queued.
 */
export const applyMerge = (tx: ChangeTransaction, payload: MergePayload): Promise<number> =>
  withRegistryLock(tx, async (locked) => {
    const source = await liveType(locked, payload.source_id);
    const target = await liveType(locked, payload.target_id);
    const queued = await moveDocuments(locked, {
      fromTypeId: source.id,
      toTypeId: target.id,
      rehoming: {
        fields: target.fields,
        renames: renamesOf(Object.entries(payload.field_mapping)),
      },
    });
    orRefuse(await markMerged(source.id, target.id, { db: locked }));
    return queued;
  });

const promotedFields = (
  type: RegisteredType,
  { field, definition, retype }: PromoteFieldPayload,
): TypeFields => {
  const existing = ownValue(type.fields, field);
  if (existing !== undefined && !isDeepStrictEqual(existing, definition) && !retype) {
    throw new ChangeRefusedError({
      code: 'primitive_conflict',
      message: `The type "${type.slug}" now has a field "${field}" with another definition.`,
    });
  }
  return { ...type.fields, [field]: definition };
};

// The registry write of a promotion: none when the field already has this definition,
// which unifies the variants into it.
const writePromotion = async (
  locked: RegistryTransaction,
  type: RegisteredType,
  { field, definition }: PromoteFieldPayload,
): Promise<void> => {
  const existing = ownValue(type.fields, field);
  if (existing === undefined) orRefuse(await addField(type.id, field, definition, { db: locked }));
  else if (!isDeepStrictEqual(existing, definition)) {
    orRefuse(await retypeField(type.id, field, definition, { db: locked }));
  }
};

/** Makes the variants of `extra` one field, with the definition of the proposal. */
export const applyPromotion = (
  tx: ChangeTransaction,
  payload: PromoteFieldPayload,
): Promise<number> =>
  withRegistryLock(tx, async (locked) => {
    const type = await liveType(locked, payload.type_id);
    const queued = await moveDocuments(locked, {
      fromTypeId: type.id,
      toTypeId: type.id,
      rehoming: {
        fields: promotedFields(type, payload),
        renames: renamesOf(payload.variants.map((variant) => [variant, payload.field])),
      },
    });
    await writePromotion(locked, type, payload);
    return queued;
  });

/** Removes a field from the schema; the values it held go to `extra`. */
export const applyFieldRemoval = (
  tx: ChangeTransaction,
  { type_id: typeId, field }: RemoveFieldPayload,
): Promise<number> =>
  withRegistryLock(tx, async (locked) => {
    const type = await liveType(locked, typeId);
    const queued = await moveDocuments(locked, {
      fromTypeId: type.id,
      toTypeId: type.id,
      rehoming: {
        fields: Object.fromEntries(Object.entries(type.fields).filter(([name]) => name !== field)),
        renames: new Map(),
      },
    });
    orRefuse(await removeField(type.id, field, { db: locked }));
    return queued;
  });

/** A status change and nothing more: no document is extracted again. */
export const applyStabilization = (
  tx: ChangeTransaction,
  { type_id: typeId }: StabilizePayload,
): Promise<number> =>
  withRegistryLock(tx, async (locked) => {
    const type = await liveType(locked, typeId);
    if (type.status === 'stable') {
      throw new ChangeRefusedError({
        code: 'already_stable',
        message: `The type "${type.slug}" is already stable.`,
      });
    }
    orRefuse(await setStatus(type.id, 'stable', { db: locked }));
    return 0;
  });
