import type { TypeReviewReason } from '@liasse/contract/domain';
import { and, asc, count, eq, not, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { PIPELINE_PROVENANCE_KEY, readPipelineProvenance } from '../domain/provenance.ts';
import { TYPE_REASON_OUTCOMES, typeReason } from './confidence.ts';
import type { PipelineDocument } from './document.ts';
import { pendingWriteOf } from './pending-write.ts';
import {
  type ReclassificationOutcome,
  requestReclassification,
} from './request-reclassification.ts';

export interface FlaggedReclassificationCounts {
  readonly queued: number;
  readonly skipped: number;
  readonly remaining: number;
}

// The rule of `typeReason`, in SQL: a type chosen by hand records no outcome.
const flaggedFor = (reason: TypeReviewReason): SQL | undefined =>
  and(
    eq(documents.status, 'needs_review'),
    sql`${documents.provenance} -> ${PIPELINE_PROVENANCE_KEY} -> 'type' ->> 'outcome' = ${TYPE_REASON_OUTCOMES[reason]}`,
  );

const pendingWrite = sql`exists (select 1 from ${jobs} where ${pendingWriteOf(documents.id)})`;

const countWhere = async (db: Database, condition: SQL | undefined): Promise<number> => {
  const [row] = await db.select({ total: count() }).from(documents).where(condition);
  return row?.total ?? 0;
};

const stillFlaggedFor =
  (reason: TypeReviewReason) =>
  (document: PipelineDocument): boolean =>
    document.status === 'needs_review' &&
    typeReason(readPipelineProvenance(document.provenance).type) === reason;

/**
 * Asks for the type of every document flagged for review with `reason` to be decided
 * again, the oldest `limit` of them, one request at a time, each under the row lock of its
 * document and with the refusals of a single request. A document whose type or values a
 * job is about to rewrite is skipped, and so is one that no longer has the reason once
 * locked: a person corrected it, or a job settled it, after the list was read.
 */
export const requestFlaggedReclassifications = async (
  db: Database,
  reason: TypeReviewReason,
  limit: number,
): Promise<FlaggedReclassificationCounts> => {
  const flagged = flaggedFor(reason);
  const free = and(flagged, not(pendingWrite));
  const pending = await countWhere(db, and(flagged, pendingWrite));
  const chosen = await db
    .select({ id: documents.id })
    .from(documents)
    .where(free)
    .orderBy(asc(documents.id))
    .limit(limit);
  const outcomes: ReclassificationOutcome[] = [];
  for (const { id } of chosen) {
    outcomes.push(await requestReclassification(db, id, { onlyIf: stillFlaggedFor(reason) }));
  }
  const queued = outcomes.filter((outcome) => outcome === 'queued').length;
  return {
    queued,
    skipped: pending + outcomes.length - queued,
    remaining: await countWhere(db, free),
  };
};
