import { isDeepStrictEqual } from 'node:util';
import {
  CHANGE_STATUSES,
  FIELD_PROMOTION_SAMPLES,
  FIELD_PROMOTION_SHARE,
  MAX_FIELDS_PER_TYPE,
  MIN_FIELD_PROMOTION_DOCUMENTS,
  SETTLED_STATUSES,
} from '@liasse/contract/domain';
import { ownValue } from '@liasse/contract/registry';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { checkField } from '../registry/fields.ts';
import { hasChange, insertChange, type StoredChange } from './change-store.ts';
import type { ConsolidationContext } from './context.ts';
import { skippingModelErrors } from './model-errors.ts';
import type { PromoteFieldPayload } from './payloads.ts';
import {
  askPromotions,
  type PromotionCandidate,
  type PromotionRequest,
  type ProposedPromotion,
} from './promotion-prompt.ts';
import type { TypeProfile } from './type-profiles.ts';

// Values of public documents only, as for the examples of a merge.
const samplesOf = async (db: Database, typeId: string, key: string): Promise<readonly unknown[]> =>
  (
    await db
      .select({ value: sql<unknown>`${documents.extra} -> ${key}` })
      .from(documents)
      .where(
        and(
          eq(documents.typeId, typeId),
          eq(documents.private, false),
          isLiveDocument,
          inArray(documents.status, [...SETTLED_STATUSES]),
          sql`${documents.extra} ? ${key}`,
        ),
      )
      .orderBy(desc(documents.ingestedAt), desc(documents.id))
      .limit(FIELD_PROMOTION_SAMPLES)
  ).map(({ value }) => value);

// A key of `extra` frequent enough, and not offered before: a promotion that names it as a
// variant settles it, whatever became of it. Values that fitted no field stay in `extra`
// after an applied promotion, and must not bring the key back at every run.
const candidatesOf = async (
  db: Database,
  { type, documents: count, extraKeys }: TypeProfile,
): Promise<readonly PromotionCandidate[]> => {
  const frequent = [...extraKeys].filter(
    ([, carried]) =>
      carried >= MIN_FIELD_PROMOTION_DOCUMENTS && carried >= count * FIELD_PROMOTION_SHARE,
  );
  const candidates: PromotionCandidate[] = [];
  for (const [key, carried] of frequent) {
    const offered = await hasChange(
      db,
      'promote_field',
      { type_id: type.id, variants: [key] },
      CHANGE_STATUSES,
    );
    if (!offered) {
      candidates.push({ key, documents: carried, samples: await samplesOf(db, type.id, key) });
    }
  }
  return candidates;
};

// What the registry would take of a proposal, as a payload: a valid name and definition,
// variants that are keys of `extra`, and room for a new field.
const payloadOf = (
  { type, extraKeys }: TypeProfile,
  { key, name, definition, variants }: ProposedPromotion,
): PromoteFieldPayload | undefined => {
  const checked = checkField(name, definition);
  if (!checked.ok) return undefined;
  const [, valid] = checked.value;
  const existing = ownValue(type.fields, name);
  const full = Object.keys(type.fields).length >= MAX_FIELDS_PER_TYPE;
  if (existing === undefined && full) return undefined;
  return {
    type_id: type.id,
    field: name,
    definition: valid,
    variants: [...new Set([key, ...variants.filter((variant) => extraKeys.has(variant))])],
    retype: existing !== undefined && !isDeepStrictEqual(existing, valid),
  };
};

const recordPromotions = async (
  db: Database,
  profile: TypeProfile,
  proposals: readonly ProposedPromotion[],
  model: string,
): Promise<readonly StoredChange[]> => {
  const recorded: StoredChange[] = [];
  const claimed = new Set<string>();
  for (const proposal of proposals) {
    const payload = payloadOf(profile, proposal);
    if (payload === undefined || payload.variants.some((variant) => claimed.has(variant))) continue;
    payload.variants.forEach((variant) => claimed.add(variant));
    recorded.push(
      await insertChange(db, {
        kind: 'promote_field',
        payload,
        rationale: `${proposal.rationale} (${model})`,
        auto: !payload.retype,
      }),
    );
  }
  return recorded;
};

/**
 * Step 2: for each type whose documents mostly carry a key of `extra`, the text model
 * proposes a canonical name and a primitive, and unifies the variants of the name. Each
 * valid proposal is a `promote_field` change; one that redefines an existing field is a
 * retyping, which needs approval.
 */
export const proposePromotions = async (
  context: ConsolidationContext,
  profiles: readonly TypeProfile[],
  signal?: AbortSignal,
): Promise<readonly StoredChange[]> => {
  const proposed: StoredChange[] = [];
  for (const profile of profiles) {
    const candidates = await candidatesOf(context.db, profile);
    if (candidates.length === 0) continue;
    const request: PromotionRequest = {
      type: profile.type,
      documents: profile.documents,
      candidates,
      keys: [...profile.extraKeys].toSorted(([, a], [, b]) => b - a),
    };
    const answer = await skippingModelErrors(() =>
      askPromotions(context.textModel, context.schemaLanguage, request, signal),
    );
    if (answer === undefined) continue;
    proposed.push(
      ...(await recordPromotions(context.db, profile, answer.promotions, answer.model)),
    );
  }
  return proposed;
};
