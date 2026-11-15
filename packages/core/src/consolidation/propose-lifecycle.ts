import {
  FIELD_CLEANUP_MIN_DOCUMENTS,
  FIELD_CLEANUP_SHARE,
  STABILIZATION_DOCUMENTS,
} from '@liasse/contract/domain';
import type { Database } from '../db/client.ts';
import { hasChange, insertChange, type StoredChange } from './change-store.ts';
import type { RemoveFieldPayload, StabilizePayload } from './payloads.ts';
import type { TypeProfile } from './type-profiles.ts';

const hasOpenMerge = async (db: Database, typeId: string): Promise<boolean> =>
  (await hasChange(db, 'merge', { source_id: typeId }, ['pending'])) ||
  (await hasChange(db, 'merge', { target_id: typeId }, ['pending']));

/**
 * Step 3: a provisional type with enough documents and no open merge proposal becomes
 * stable. Proposed once per type, unless a person rejected it: then never again.
 */
export const proposeStabilizations = async (
  db: Database,
  profiles: readonly TypeProfile[],
): Promise<readonly StoredChange[]> => {
  const proposed: StoredChange[] = [];
  for (const { type, documents } of profiles) {
    if (type.status !== 'provisional' || documents < STABILIZATION_DOCUMENTS) continue;
    const payload: StabilizePayload = { type_id: type.id };
    if (await hasChange(db, 'stabilize', payload, ['pending', 'rejected'])) continue;
    if (await hasOpenMerge(db, type.id)) continue;
    proposed.push(
      await insertChange(db, {
        kind: 'stabilize',
        payload,
        rationale: `"${type.slug}" has ${String(documents)} documents and no open merge proposal.`,
        auto: true,
      }),
    );
  }
  return proposed;
};

/**
 * Step 4: a field of a stable type with many documents that few of them fill is proposed
 * for removal. A removal always waits for approval under `AUTO_APPLY=safe`; one pending
 * or rejected is not proposed again.
 */
export const proposeCleanups = async (
  db: Database,
  profiles: readonly TypeProfile[],
): Promise<readonly StoredChange[]> => {
  const proposed: StoredChange[] = [];
  for (const { type, documents, filledFields } of profiles) {
    if (type.status !== 'stable' || documents < FIELD_CLEANUP_MIN_DOCUMENTS) continue;
    for (const field of Object.keys(type.fields)) {
      const filled = filledFields.get(field) ?? 0;
      if (filled >= documents * FIELD_CLEANUP_SHARE) continue;
      const payload: RemoveFieldPayload = { type_id: type.id, field };
      if (await hasChange(db, 'remove_field', payload, ['pending', 'rejected'])) continue;
      proposed.push(
        await insertChange(db, {
          kind: 'remove_field',
          payload,
          rationale: `"${field}" is filled in ${String(filled)} of the ${String(documents)} documents of "${type.slug}".`,
          auto: false,
        }),
      );
    }
  }
  return proposed;
};
