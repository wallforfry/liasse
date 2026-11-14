import { isDeepStrictEqual } from 'node:util';
import { ownValue } from '../registry/own.ts';
import { findTypeById } from '../registry/type-store.ts';
import type { ChangeReader } from './change-store.ts';
import type { ConsolidationChange } from './payloads.ts';
import { isSafeMerge } from './policy.ts';

const liveType = async (reader: ChangeReader, id: string) => {
  const type = await findTypeById(reader, id);
  return type === undefined || type.status === 'merged' ? undefined : type;
};

/**
 * Whether a change is still safe by the auto-apply policy, read from the registry as it
 * is when the change is applied: a merge proposed for two provisional types is not safe
 * once one of them became stable, nor a promotion once its field got another definition.
 * Entity and subject merges are safe by the identifiers their proposal found, which
 * only a merge of one of them changes, and that merge refuses the change anyway.
 */
export const isStillSafe = async (
  reader: ChangeReader,
  change: ConsolidationChange,
): Promise<boolean> => {
  switch (change.kind) {
    case 'merge': {
      const source = await liveType(reader, change.payload.source_id);
      const target = await liveType(reader, change.payload.target_id);
      return (
        source !== undefined &&
        target !== undefined &&
        isSafeMerge(source, target, change.payload.field_mapping, change.payload.confidence)
      );
    }
    case 'promote_field': {
      const type = await liveType(reader, change.payload.type_id);
      if (type === undefined || change.payload.retype) return false;
      const existing = ownValue(type.fields, change.payload.field);
      return existing === undefined || isDeepStrictEqual(existing, change.payload.definition);
    }
    case 'stabilize':
      return (await liveType(reader, change.payload.type_id))?.status === 'provisional';
    case 'remove_field':
      return false;
    case 'merge_entity':
    case 'merge_subject':
      return true;
  }
};
