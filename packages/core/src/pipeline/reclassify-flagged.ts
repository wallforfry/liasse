import { TYPE_REFUSALS, type TypeReviewReason } from '@liasse/contract/domain';
import { and, asc, count, eq, inArray, not, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { documentEvents } from '../db/schema/document-events.ts';
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
  readonly refused: number;
  readonly remaining: number;
}

// The rule of `typeReason`, in SQL: a type chosen by hand records no outcome.
const flaggedFor = (reason: TypeReviewReason): SQL | undefined =>
  and(
    eq(documents.status, 'needs_review'),
    sql`${documents.provenance} -> ${PIPELINE_PROVENANCE_KEY} -> 'type' ->> 'outcome' = ${TYPE_REASON_OUTCOMES[reason]}`,
  );

const pendingWrite = sql`exists (select 1 from ${jobs} where ${pendingWriteOf(documents.id)})`;

// A reclassification the registry or the privacy rule refused changes nothing and logs a
// failed `classification` event with that refusal, the last of the document: asking
// again would pay the model for the same refusal, and keep the oldest documents ahead of
// those never tried. An attempt that failed for another cause, such as a provider outage,
// may succeed the next time.
const refusedBefore = sql`coalesce((
  select ${documentEvents.outcome} = 'failed' and ${inArray(documentEvents.errorCode, TYPE_REFUSALS)}
  from ${documentEvents}
  where ${documentEvents.documentId} = ${documents.id}
    and ${documentEvents.stage} = 'classification'
  order by ${documentEvents.occurredAt} desc, ${documentEvents.id} desc
  limit 1
), false)`;

const countWhere = async (db: Database, condition: SQL | undefined): Promise<number> => {
  const [row] = await db.select({ total: count() }).from(documents).where(condition);
  return row?.total ?? 0;
};

export const stillFlaggedFor =
  (reason: TypeReviewReason) =>
  (document: PipelineDocument): boolean =>
    document.status === 'needs_review' &&
    typeReason(readPipelineProvenance(document.provenance).type) === reason;

/**
 * Asks for the type of every document flagged for review with `reason` to be decided
 * again, the oldest `limit` of them, one request at a time, each under the row lock of its
 * document and with the refusals of a single request. A document whose type or values a
 * job is about to rewrite is skipped, and so is one that no longer has the reason once
 * locked: a person corrected it, or a job settled it, after the list was read. One whose
 * last reclassification was refused is left out and counted apart. The counts are read
 * apart from the requests, so a job that ends meanwhile can make them overlap by a few. An error part way
 * rejects the request; the documents queued before it stay queued, and are skipped by
 * the next request.
 */
export const requestFlaggedReclassifications = async (
  db: Database,
  reason: TypeReviewReason,
  limit: number,
): Promise<FlaggedReclassificationCounts> => {
  const flagged = flaggedFor(reason);
  const free = and(flagged, not(pendingWrite), not(refusedBefore));
  const pending = await countWhere(db, and(flagged, pendingWrite));
  const refused = await countWhere(db, and(flagged, not(pendingWrite), refusedBefore));
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
    refused,
    remaining: await countWhere(db, free),
  };
};
