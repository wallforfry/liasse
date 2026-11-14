import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { jobs } from '../db/schema/jobs.ts';
import { type JobKind, parseJobPayload } from './kinds.ts';

export const JOBS_CHANNEL = 'liasse_jobs';

/** A database handle or an open transaction: the job then commits with the caller's rows. */
export type JobExecutor = Pick<Database, 'insert' | 'execute'>;

export interface EnqueueInput<Payload extends JsonObject> {
  readonly kind: JobKind<Payload>;
  readonly payload: Payload;
  readonly runAfter?: Date;
}

export const enqueue = async <Payload extends JsonObject>(
  executor: JobExecutor,
  { kind, payload, runAfter }: EnqueueInput<Payload>,
): Promise<string> => {
  const [job] = await executor
    .insert(jobs)
    .values({
      kind: kind.name,
      payload: parseJobPayload(kind, payload),
      ...(runAfter === undefined ? {} : { runAfter }),
      ...(kind.maxAttempts === undefined ? {} : { maxAttempts: kind.maxAttempts }),
    })
    .returning({ id: jobs.id });
  if (job === undefined) throw new Error(`The ${kind.name} job was not inserted`);
  // Postgres delivers a notification at commit, so a worker never wakes for a job it cannot see.
  await executor.execute(sql`SELECT pg_notify(${JOBS_CHANNEL}, ${kind.name})`);
  return job.id;
};
