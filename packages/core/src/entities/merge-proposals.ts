import { ok, type Result } from '../registry/result.ts';
import type { EntitiesWriteContext } from './context.ts';
import { withEntityLock } from './entity-lock.ts';
import type { Entity } from './entity-store.ts';
import type { EntityMergeError } from './errors.ts';
import { sharedGlobalIdentifiers, type StoredIdentifier } from './identifiers.ts';
import { type EntityPair, findMergeablePair } from './merge.ts';
import { sharesName } from './merge-candidates.ts';
import { type RecordedProposal, recordProposal } from './proposal-store.ts';

export type ProposedEntityMerge = RecordedProposal;

// A sensitive identifier is named by its last characters only.
const describeIdentifier = (identifier: StoredIdentifier): string => {
  const type = identifier.type.replaceAll('_', ' ');
  return 'hash' in identifier
    ? `${type} ending in ${identifier.last4}`
    : `${type} ${identifier.value}`;
};

const describeRelation = (
  source: Entity,
  target: Entity,
  shared: readonly StoredIdentifier[],
): string => {
  const [identifier] = shared;
  const pair = `"${source.canonicalName}" and "${target.canonicalName}"`;
  if (identifier !== undefined) return `${pair} carry the same ${describeIdentifier(identifier)}.`;
  return sharesName(source, target)
    ? `${pair} go by the same name once normalized, and share no global identifier.`
    : `${pair} share no global identifier and no normalized name.`;
};

export interface ProposeEntityMergeInput extends EntityPair {
  // Why the two are one entity, when the caller knows more than the identifiers say.
  readonly rationale?: string | undefined;
}

// Records the proposal to merge the source into the target. Refuses what `mergeEntities`
// would refuse, and never applies anything.
export const proposeEntityMerge = (
  { db }: EntitiesWriteContext,
  { rationale, ...pair }: ProposeEntityMergeInput,
): Promise<Result<ProposedEntityMerge, EntityMergeError>> =>
  withEntityLock(db, async (tx) => {
    const found = await findMergeablePair(tx, pair);
    if (!found.ok) return found;
    const { source, target } = found.value;
    const shared = sharedGlobalIdentifiers(source.identifiers, target.identifiers);
    return ok(
      await recordProposal(tx, {
        sourceId: source.id,
        targetId: target.id,
        rationale: rationale ?? describeRelation(source, target, shared),
        auto: shared.length > 0,
      }),
    );
  });
