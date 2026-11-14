import { and, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { typeChanges } from '../db/schema/registry.ts';
import type { ChangeStatus } from '../domain/enums.ts';
import { ok, type Result } from '../registry/result.ts';
import type { EntitiesWriteContext } from './context.ts';
import { withEntityLock } from './entity-lock.ts';
import type { Entity, EntityReader } from './entity-store.ts';
import type { EntityMergeError } from './errors.ts';
import { sharedGlobalIdentifiers, type StoredIdentifier } from './identifiers.ts';
import { type EntityPair, findMergeablePair } from './merge.ts';
import { sharesName } from './merge-candidates.ts';

const MERGE_ENTITY = 'merge_entity';

// The payload of a `merge_entity` change: what `mergeEntities` needs to apply it.
export const mergeEntityPayloadSchema = z.strictObject({
  source_id: z.string().min(1),
  target_id: z.string().min(1),
});
export type MergeEntityPayload = z.output<typeof mergeEntityPayloadSchema>;

export interface EntityMergeProposal {
  readonly id: string;
  readonly payload: MergeEntityPayload;
  readonly rationale: string;
  readonly status: ChangeStatus;
  // True when the two entities share a company id, a VAT number, an IBAN or a card
  // number: such a merge needs no approval. A shared customer number is not enough.
  // Whether it is applied without one is the decision of the consolidation policy.
  readonly auto: boolean;
}

export interface ProposedEntityMerge {
  readonly proposal: EntityMergeProposal;
  // False when the pair already had a proposal, whatever became of it: the one returned.
  readonly created: boolean;
}

const PROPOSAL_COLUMNS = {
  id: typeChanges.id,
  payload: typeChanges.payload,
  rationale: typeChanges.rationale,
  status: typeChanges.status,
  auto: typeChanges.auto,
} as const;

interface ProposalRow extends Omit<EntityMergeProposal, 'payload'> {
  readonly payload: unknown;
}

const toProposal = ({ payload, ...row }: ProposalRow): EntityMergeProposal => ({
  ...row,
  payload: mergeEntityPayloadSchema.parse(payload),
});

const between = (sourceId: string, targetId: string) =>
  sql`${typeChanges.payload} @> ${JSON.stringify({ source_id: sourceId, target_id: targetId })}::jsonb`;

// In either direction: a pair that was proposed once, and rejected, is not proposed again
// by the next consolidation run.
const findProposal = async (
  reader: EntityReader,
  { sourceId, targetId }: EntityPair,
): Promise<EntityMergeProposal | undefined> => {
  const [row] = await reader
    .select(PROPOSAL_COLUMNS)
    .from(typeChanges)
    .where(
      and(
        eq(typeChanges.kind, MERGE_ENTITY),
        or(between(sourceId, targetId), between(targetId, sourceId)),
      ),
    )
    .orderBy(typeChanges.id)
    .limit(1);
  return row === undefined ? undefined : toProposal(row);
};

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
    const existing = await findProposal(tx, pair);
    if (existing !== undefined) return ok({ proposal: existing, created: false });
    const { source, target } = found.value;
    const shared = sharedGlobalIdentifiers(source.identifiers, target.identifiers);
    const [row] = await tx
      .insert(typeChanges)
      .values({
        kind: MERGE_ENTITY,
        payload: { source_id: source.id, target_id: target.id },
        rationale: rationale ?? describeRelation(source, target, shared),
        auto: shared.length > 0,
      })
      .returning(PROPOSAL_COLUMNS);
    if (row === undefined) throw new Error('The proposal row was not written');
    return ok({ proposal: toProposal(row), created: true });
  });
