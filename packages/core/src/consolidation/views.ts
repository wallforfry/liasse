import type { ChangeDecisionResult, ChangeView } from '../contract/consolidation.ts';
import type { DecisionOutcome } from './apply-change.ts';
import type { StoredChange } from './change-store.ts';

export const viewChange = (change: StoredChange): ChangeView => ({
  id: change.id,
  kind: change.kind,
  payload: change.payload,
  rationale: change.rationale,
  status: change.status,
  auto: change.auto,
  created_at: change.createdAt.toISOString(),
  decided_at: change.decidedAt?.toISOString() ?? null,
  note: change.note,
});

export const viewDecision = ({
  change,
  reextractions,
  refusal,
}: DecisionOutcome): ChangeDecisionResult => ({
  change: viewChange(change),
  documents_to_reextract: reextractions,
  ...(refusal === undefined ? {} : { refusal }),
});
