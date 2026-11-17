import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import { index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { ID_PREFIXES, newId } from '../../domain/ids.ts';
import { createdAt, instant, jsonObject } from '../columns.ts';
import { jobStatus } from './enums.ts';

export const jobs = pgTable(
  'jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => newId(ID_PREFIXES.job)),
    kind: text('kind').notNull(),
    payload: jsonObject('payload'),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: instant('run_after').notNull().defaultNow(),
    lockedAt: instant('locked_at'),
    lastError: text('last_error'),
    // The version of the stored settings when the job was queued: a worker whose settings
    // are older puts the newer ones in force before it runs the job.
    settingsVersion: integer('settings_version').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index('jobs_dequeue_idx')
      .on(table.runAfter)
      .where(sql`${table.status} = 'queued'`),
    index('jobs_unfinished_document_idx')
      .on(sql`(${table.payload}->>'documentId')`)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

/**
 * A job not finished yet whose payload names the document, through
 * `jobs_unfinished_document_idx`. The statuses are written out: Postgres uses a partial
 * index only for a condition it can prove implies the one of the index, which a bound
 * parameter does not.
 */
export const unfinishedJobOfDocument = (documentId: SQLWrapper | string): SQL =>
  sql`${jobs.status} in ('queued', 'running') and ${jobs.payload}->>'documentId' = ${documentId}`;
