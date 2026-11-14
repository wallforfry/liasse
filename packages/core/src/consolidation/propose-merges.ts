import { TYPE_MERGE_EXAMPLES } from '../domain/limits.ts';
import { ownValue } from '../registry/own.ts';
import type { RegisteredType } from '../registry/type-store.ts';
import { insertChange, type StoredChange } from './change-store.ts';
import type { ConsolidationContext } from './context.ts';
import { askMerge, type MergeAnswer } from './merge-prompt.ts';
import type { MergePayload } from './payloads.ts';
import { isSafeMerge } from './policy.ts';
import { skippingModelErrors } from './model-errors.ts';
import { typeExamples } from './type-examples.ts';
import type { TypePair } from './type-merge-candidates.ts';

// Each field of the source maps to a field the target has, or to null. A field the model
// left out, or mapped to a field the target does not have, maps to null: its values go to
// `extra`, and the mapping is not lossless.
const mappingOf = (
  source: RegisteredType,
  target: RegisteredType,
  answer: MergeAnswer,
): Readonly<Record<string, string | null>> =>
  Object.fromEntries(
    Object.keys(source.fields).map((field) => {
      const to = answer.fieldMapping.find(({ from }) => from === field)?.to ?? null;
      return [field, to !== null && ownValue(target.fields, to) !== undefined ? to : null];
    }),
  );

const recordAnswer = async (
  { db }: ConsolidationContext,
  { left, right }: TypePair,
  answer: MergeAnswer,
): Promise<StoredChange> => {
  const [target, source] =
    answer.target === left.type.slug ? [left.type, right.type] : [right.type, left.type];
  const merging = answer.decision === 'merge';
  const mapping = merging ? mappingOf(source, target, answer) : {};
  const payload: MergePayload = {
    source_id: source.id,
    target_id: target.id,
    field_mapping: mapping,
    confidence: answer.confidence,
  };
  const change = {
    kind: 'merge' as const,
    payload,
    rationale: `${answer.rationale} (${answer.model})`,
    auto: merging && isSafeMerge(source, target, mapping, answer.confidence),
  };
  if (merging) return insertChange(db, change);
  // Recorded as rejected, so the pair is not put to the model at every run. A common
  // parent is not created by this version: a person may create one.
  const note =
    answer.decision === 'common_parent'
      ? `The text model sees "${left.type.slug}" and "${right.type.slug}" as kinds of one family; consolidation does not create common parents.`
      : `The text model sees "${left.type.slug}" and "${right.type.slug}" as distinct.`;
  return insertChange(db, change, { status: 'rejected', note });
};

/**
 * Step 1: puts each candidate pair to the text model with its schemas and three examples
 * of each type, and records its answer as a `merge` change. A pair whose answer the
 * model could not give in the schema is left for the next run.
 */
export const proposeMerges = async (
  context: ConsolidationContext,
  pairs: readonly TypePair[],
  signal?: AbortSignal,
): Promise<readonly StoredChange[]> => {
  const proposed: StoredChange[] = [];
  for (const pair of pairs) {
    const sideOf = async ({ type }: TypePair['left']) => ({
      type,
      examples: await typeExamples(context.db, type.id, TYPE_MERGE_EXAMPLES),
    });
    const left = await sideOf(pair.left);
    const right = await sideOf(pair.right);
    const answer = await skippingModelErrors(() =>
      askMerge(context.textModel, left, right, signal),
    );
    if (answer !== undefined) proposed.push(await recordAnswer(context, pair, answer));
  }
  return proposed;
};
