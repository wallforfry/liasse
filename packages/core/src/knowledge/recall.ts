import { and, eq, inArray, notInArray, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { facts } from '../db/schema/knowledge.ts';
import {
  DEFAULT_RECALL_LIMIT,
  MAX_QUERY_STRING_LENGTH,
  MAX_RECALL_LIMIT,
  MAX_RECALL_RELATED,
  RECALL_CANDIDATES_PER_RANKER,
} from '../domain/limits.ts';
import { isoDateSchema } from '../domain/values.ts';
import type { Embedder } from '../models/ports.ts';
import { reciprocalRankFusion } from '../search/fusion.ts';
import {
  parseQueryFor,
  rankByFullTextIn,
  rankByVectorIn,
  type RankedSource,
} from '../search/ranked-source.ts';
import type { KnowledgeReadContext } from './context.ts';
import { untrustedText, visibleDocument } from './read-shared.ts';

export interface RecallContext extends KnowledgeReadContext {
  readonly embedder: Embedder;
}

export const recallInputSchema = z.strictObject({
  query: z.string().max(MAX_QUERY_STRING_LENGTH),
  // Only the facts valid on that day.
  at: isoDateSchema.optional(),
  limit: z.int().min(1).max(MAX_RECALL_LIMIT).default(DEFAULT_RECALL_LIMIT),
  includePrivate: z.boolean().default(false),
});
export type RecallInput = z.input<typeof recallInputSchema>;

export const RECALL_MATCHES = ['direct', 'related'] as const;

export const recalledFactSchema = z.strictObject({
  id: z.string(),
  text: untrustedText,
  validFrom: isoDateSchema.nullable(),
  validTo: isoDateSchema.nullable(),
  // The document the fact was read in.
  documentId: z.string(),
  entityIds: z.array(z.string()).readonly(),
  subjectIds: z.array(z.string()).readonly(),
  // `direct` for a fact the query found, `related` for one that shares an entity or a
  // subject with such a fact.
  match: z.enum(RECALL_MATCHES),
});
export type RecalledFact = z.output<typeof recalledFactSchema>;

export const recallOutputSchema = z.strictObject({
  facts: z.array(recalledFactSchema).readonly(),
});
export type Recall = z.output<typeof recallOutputSchema>;

const FACT_SOURCE: RankedSource = {
  table: facts,
  id: facts.id,
  documentId: facts.documentId,
  language: facts.language,
  tsv: facts.tsv,
  embedding: facts.embedding,
};

// Valid on the day: started on or before it, and not ended before it. A bound that is
// not known does not exclude the fact: one without a start has held for as long as is
// known, as one without an end still holds.
const validAt = (at: string | undefined): SQL =>
  at === undefined
    ? sql`true`
    : sql`((${facts.validFrom} IS NULL OR ${facts.validFrom} <= ${at})
        AND (${facts.validTo} IS NULL OR ${facts.validTo} >= ${at}))`;

const FACT_COLUMNS = {
  id: facts.id,
  text: facts.text,
  validFrom: facts.validFrom,
  validTo: facts.validTo,
  documentId: facts.documentId,
  entityIds: facts.entityIds,
  subjectIds: facts.subjectIds,
} as const;

type StoredFact = Omit<RecalledFact, 'match'>;

// The facts the query finds: full text and vector, fused by reciprocal rank, best first.
// A fact of a private document embedded by no one is found by full text only.
const directHits = async (
  { db, embedder }: RecallContext,
  query: string,
  filter: SQL,
  limit: number,
): Promise<readonly StoredFact[]> => {
  const tsquery = await parseQueryFor(db, FACT_SOURCE, query);
  if (tsquery === undefined) return [];
  const request = { query, tsquery, filter, limit: RECALL_CANDIDATES_PER_RANKER };
  const rankings = await Promise.all([
    rankByFullTextIn(db, FACT_SOURCE, request),
    rankByVectorIn(db, FACT_SOURCE, embedder, request),
  ]);
  const scores = reciprocalRankFusion(rankings.map((ranking) => ranking.map(({ id }) => id)));
  const best = [...scores.entries()]
    .toSorted(([leftId, left], [rightId, right]) => right - left || (leftId < rightId ? -1 : 1))
    .slice(0, limit)
    .map(([id]) => id);
  if (best.length === 0) return [];
  // A fact or a document deleted since the candidates were read is left out.
  const rows = await db
    .select(FACT_COLUMNS)
    .from(facts)
    .innerJoin(documents, eq(documents.id, facts.documentId))
    .where(and(inArray(facts.id, best), filter));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return best.flatMap((id) => byId.get(id) ?? []);
};

const overlaps = (column: typeof facts.entityIds, ids: readonly string[]): SQL | undefined =>
  ids.length === 0
    ? undefined
    : sql`${column} && ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[]`;

const sharedCount = (column: typeof facts.entityIds, ids: readonly string[]): SQL =>
  ids.length === 0
    ? sql`0`
    : sql`cardinality(ARRAY(
        SELECT unnest(${column}) INTERSECT SELECT unnest(ARRAY[${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[])
      ))`;

// One hop from the direct hits: the other facts about their entities and their subjects,
// those that share the most first, then the most recent. Never further: a fact reached
// through a related fact is not returned.
const relatedFacts = async (
  db: Database,
  direct: readonly StoredFact[],
  filter: SQL,
  limit: number,
): Promise<readonly StoredFact[]> => {
  const entityIds = [...new Set(direct.flatMap((fact) => fact.entityIds))];
  const subjectIds = [...new Set(direct.flatMap((fact) => fact.subjectIds))];
  const related = or(overlaps(facts.entityIds, entityIds), overlaps(facts.subjectIds, subjectIds));
  if (related === undefined || limit === 0) return [];
  return db
    .select(FACT_COLUMNS)
    .from(facts)
    .innerJoin(documents, eq(documents.id, facts.documentId))
    .where(
      and(
        related,
        filter,
        notInArray(
          facts.id,
          direct.map(({ id }) => id),
        ),
      ),
    )
    .orderBy(
      sql`${sharedCount(facts.entityIds, entityIds)} + ${sharedCount(facts.subjectIds, subjectIds)} DESC`,
      sql`${facts.validFrom} DESC NULLS LAST`,
      facts.id,
    )
    .limit(limit);
};

/**
 * Fact search, memory-style: the stored facts a question finds, then the facts one hop
 * away through their entities and subjects, ranked below them. `at` keeps the facts
 * valid on a day. Each fact comes with its validity and the document it was read in.
 * No opinion and no synthesis: a fact is returned as it was stored.
 */
export const recall = async (context: RecallContext, input: RecallInput): Promise<Recall> => {
  const { query, at, limit, includePrivate } = recallInputSchema.parse(input);
  // Postgres text cannot hold a NUL character.
  const text = query.replaceAll('\u0000', ' ').trim();
  if (text === '') return { facts: [] };
  const filter = sql`${visibleDocument(includePrivate)} AND ${validAt(at)}`;
  const direct = await directHits(context, text, filter, limit);
  const related = await relatedFacts(
    context.db,
    direct,
    filter,
    Math.min(limit, MAX_RECALL_RELATED),
  );
  return {
    facts: [
      ...direct.map((fact) => ({ ...fact, match: 'direct' as const })),
      ...related.map((fact) => ({ ...fact, match: 'related' as const })),
    ],
  };
};
