import { sql } from 'drizzle-orm';
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
    createdAt: createdAt(),
  },
  (table) => [
    index('jobs_dequeue_idx')
      .on(table.runAfter)
      .where(sql`${table.status} = 'queued'`),
  ],
);
