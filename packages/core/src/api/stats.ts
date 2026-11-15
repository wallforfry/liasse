import type { DocumentStatus, JobStatus } from '@liasse/contract/domain';
import { count, min, sql } from 'drizzle-orm';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import type { ApiContext } from './context.ts';

export interface Stats {
  /** Live documents by status. A status without a document is absent. */
  readonly documents: readonly { readonly status: DocumentStatus; readonly count: number }[];
  readonly jobs: readonly {
    readonly kind: string;
    readonly status: JobStatus;
    readonly count: number;
  }[];
  /** Jobs that could run now: queued and past their `run_after`. */
  readonly queueDepth: number;
  /** How long the oldest of them has been waiting, 0 when the queue is empty. */
  readonly oldestQueuedAgeSeconds: number;
}

/** Counts only: nothing here is read from a document. */
export const readStats = async ({ db }: Pick<ApiContext, 'db'>): Promise<Stats> => {
  const due = sql`${jobs.status} = 'queued' AND ${jobs.runAfter} <= now()`;
  const [byStatus, byKind, [queue]] = await Promise.all([
    db
      .select({ status: documents.status, count: count() })
      .from(documents)
      .where(isLiveDocument)
      .groupBy(documents.status),
    db
      .select({ kind: jobs.kind, status: jobs.status, count: count() })
      .from(jobs)
      .groupBy(jobs.kind, jobs.status),
    db
      .select({
        depth: count(),
        age: sql<number>`coalesce(extract(epoch from now() - ${min(jobs.runAfter)}), 0)::float8`,
      })
      .from(jobs)
      .where(due),
  ]);
  return {
    documents: byStatus,
    jobs: byKind,
    queueDepth: queue?.depth ?? 0,
    oldestQueuedAgeSeconds: Math.max(0, queue?.age ?? 0),
  };
};
