import { isDeepStrictEqual } from 'node:util';
import { ownValue } from '../registry/own.ts';
import {
  findTypeById,
  type RegistryTransaction,
  withRegistryLock,
} from '../registry/type-store.ts';
import type { ChangeTransaction } from './change-store.ts';
import type { ConsolidationChange } from './payloads.ts';
import { isSafeMerge } from './policy.ts';

const liveType = async (reader: RegistryTransaction, id: string) => {
  const type = await findTypeById(reader, id);
  return type === undefined || type.status === 'merged' ? undefined : type;
};

type TypeChange = Extract<ConsolidationChange, { kind: 'merge' | 'promote_field' | 'stabilize' }>;

const isSafeTypeChange = async (
  locked: RegistryTransaction,
  change: TypeChange,
): Promise<boolean> => {
  switch (change.kind) {
    case 'merge': {
      const source = await liveType(locked, change.payload.source_id);
      const target = await liveType(locked, change.payload.target_id);
      return (
        source !== undefined &&
        target !== undefined &&
        isSafeMerge(source, target, change.payload.field_mapping, change.payload.confidence)
      );
    }
    case 'promote_field': {
      const type = await liveType(locked, change.payload.type_id);
      if (type === undefined || change.payload.retype) return false;
      const existing = ownValue(type.fields, change.payload.field);
      return existing === undefined || isDeepStrictEqual(existing, change.payload.definition);
    }
    case 'stabilize':
      return (await liveType(locked, change.payload.type_id))?.status === 'provisional';
  }
};

/**
 * Whether a change is still safe by the auto-apply policy, read from the registry as it
 * is when the change is applied: a merge proposed for two provisional types is not safe
 * once one of them became stable, nor a promotion once its field got another definition.
 * A change of a type is read under the registry lock, taken in the transaction of the
 * change and held until it commits, so no registry write lands between this reading and
 * the application. Entity and subject merges are safe by the identifiers their proposal
 * found, which only a merge of one of them changes, and that merge refuses the change.
 */
export const isStillSafe = async (
  tx: ChangeTransaction,
  change: ConsolidationChange,
): Promise<boolean> => {
  switch (change.kind) {
    case 'merge':
    case 'promote_field':
    case 'stabilize':
      return withRegistryLock(tx, (locked) => isSafeTypeChange(locked, change));
    case 'remove_field':
      return false;
    case 'merge_entity':
    case 'merge_subject':
      return true;
  }
};
