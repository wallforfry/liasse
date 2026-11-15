import {
  CHANGE_STATUSES,
  MAX_TYPE_MERGE_PAIRS_PER_RUN,
  TYPE_MERGE_FIELD_OVERLAP,
  TYPE_MERGE_ISSUER_OVERLAP,
  TYPE_MERGE_SIMILARITY,
} from '@liasse/contract/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { docTypes } from '../db/schema/registry.ts';
import { hasChange } from './change-store.ts';
import type { TypeProfile } from './type-profiles.ts';

export interface TypePair {
  readonly left: TypeProfile;
  readonly right: TypeProfile;
  /** Cosine similarity of the two descriptions. */
  readonly similarity: number;
}

const similaritySchema = z.array(
  z.object({ left: z.string(), right: z.string(), similarity: z.coerce.number() }),
);

const similarities = async (db: Database): Promise<ReadonlyMap<string, number>> => {
  const rows = similaritySchema.parse(
    await db.execute(sql`
      SELECT a.id AS left, b.id AS right, 1 - (a.embedding <=> b.embedding) AS similarity
      FROM ${docTypes} a JOIN ${docTypes} b ON a.id < b.id
      WHERE a.status <> 'merged' AND b.status <> 'merged'
        AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL`),
  );
  return new Map(rows.map(({ left, right, similarity }) => [`${left}|${right}`, similarity]));
};

const jaccard = (left: ReadonlySet<string>, right: ReadonlySet<string>): number => {
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : [...left].filter((item) => right.has(item)).length / union;
};

// Documents of two types overlap strongly when the types define mostly the same fields
// and their documents come mostly from the same issuers.
const overlaps = ({ left, right }: Pick<TypePair, 'left' | 'right'>): boolean =>
  jaccard(new Set(Object.keys(left.type.fields)), new Set(Object.keys(right.type.fields))) >=
    TYPE_MERGE_FIELD_OVERLAP && jaccard(left.issuers, right.issuers) >= TYPE_MERGE_ISSUER_OVERLAP;

const proposedBefore = async (db: Database, { left, right }: TypePair): Promise<boolean> =>
  (await hasChange(
    db,
    'merge',
    { source_id: left.type.id, target_id: right.type.id },
    CHANGE_STATUSES,
  )) ||
  hasChange(db, 'merge', { source_id: right.type.id, target_id: left.type.id }, CHANGE_STATUSES);

/**
 * Step 1, its candidates: the pairs of types whose descriptions are similar enough, or
 * whose documents overlap strongly, that no merge was proposed for before, in either
 * direction and whatever became of it. The most similar first, at most
 * `MAX_TYPE_MERGE_PAIRS_PER_RUN`: the others wait for the next run.
 */
export const findTypeMergeCandidates = async (
  db: Database,
  profiles: readonly TypeProfile[],
): Promise<readonly TypePair[]> => {
  const scores = await similarities(db);
  const pairs = profiles.flatMap((left, index) =>
    profiles.slice(index + 1).map((right) => {
      const [first, second] = left.type.id < right.type.id ? [left, right] : [right, left];
      return {
        left: first,
        right: second,
        similarity: scores.get(`${first.type.id}|${second.type.id}`) ?? 0,
      };
    }),
  );
  const candidates = pairs
    .filter((pair) => pair.similarity > TYPE_MERGE_SIMILARITY || overlaps(pair))
    .toSorted((a, b) => b.similarity - a.similarity);
  const fresh: TypePair[] = [];
  for (const pair of candidates) {
    if (fresh.length >= MAX_TYPE_MERGE_PAIRS_PER_RUN) break;
    if (!(await proposedBefore(db, pair))) fresh.push(pair);
  }
  return fresh;
};
