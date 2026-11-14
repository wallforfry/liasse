import { and, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { typeChanges } from '../db/schema/registry.ts';
import type { ChangeKind, ChangeStatus } from '../domain/enums.ts';
import type { EntityReader, EntityTransaction } from './entity-store.ts';

// The kinds of change that merge two rows of one table into one. They have the same
// payload and the same rule: a pair is proposed once.
export type MergeChangeKind = Extract<ChangeKind, 'merge_entity' | 'merge_subject'>;

const MERGE_ENTITY = 'merge_entity' satisfies MergeChangeKind;

// The payload of a merge change: what `mergeEntities`, or the merge of its kind, needs
// to apply it.
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

export interface RecordedProposal {
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

// In either direction: a pair that was proposed once, and rejected, is not proposed again.
const findProposal = async (
  reader: EntityReader,
  kind: MergeChangeKind,
  sourceId: string,
  targetId: string,
): Promise<EntityMergeProposal | undefined> => {
  const [row] = await reader
    .select(PROPOSAL_COLUMNS)
    .from(typeChanges)
    .where(
      and(eq(typeChanges.kind, kind), or(between(sourceId, targetId), between(targetId, sourceId))),
    )
    .orderBy(typeChanges.id)
    .limit(1);
  return row === undefined ? undefined : toProposal(row);
};

export interface NewProposal {
  readonly sourceId: string;
  readonly targetId: string;
  readonly rationale: string;
  readonly auto: boolean;
}

// Records the proposal unless the pair has one. Runs under the entity lock.
export const recordMergeProposal = async (
  tx: EntityTransaction,
  kind: MergeChangeKind,
  { sourceId, targetId, rationale, auto }: NewProposal,
): Promise<RecordedProposal> => {
  const existing = await findProposal(tx, kind, sourceId, targetId);
  if (existing !== undefined) return { proposal: existing, created: false };
  const [row] = await tx
    .insert(typeChanges)
    .values({ kind, payload: { source_id: sourceId, target_id: targetId }, rationale, auto })
    .returning(PROPOSAL_COLUMNS);
  if (row === undefined) throw new Error('The proposal row was not written');
  return { proposal: toProposal(row), created: true };
};

export const recordProposal = (
  tx: EntityTransaction,
  proposal: NewProposal,
): Promise<RecordedProposal> => recordMergeProposal(tx, MERGE_ENTITY, proposal);
