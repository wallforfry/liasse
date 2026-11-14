import { setTimeout as delay } from 'node:timers/promises';
import { type Database, documents, isLiveDocument, jobs } from '@liasse/core/db';
import type { DocumentStatus, JobStatus } from '@liasse/core/domain';
import { and, inArray } from 'drizzle-orm';

const PENDING_JOBS: readonly JobStatus[] = ['queued', 'running'];
// A document in one of these is still owed a step of the pipeline.
const IN_PROGRESS: readonly DocumentStatus[] = ['received', 'extracted', 'classified'];

const POLL_INTERVAL_MS = 250;

const isSettled = async (db: Database): Promise<boolean> => {
  const [pendingJobs, unfinished] = await Promise.all([
    db.$count(jobs, inArray(jobs.status, [...PENDING_JOBS])),
    db.$count(documents, and(isLiveDocument, inArray(documents.status, [...IN_PROGRESS]))),
  ]);
  return pendingJobs === 0 && unfinished === 0;
};

/**
 * Resolves once the pipeline has nothing left to do: no job queued or running, a job to
 * retry later included, and no document between two steps. No bound: with real models a
 * corpus takes as long as the models take, and the operator ends a run that hangs.
 */
export const waitForPipeline = async (db: Database): Promise<void> => {
  while (!(await isSettled(db))) await delay(POLL_INTERVAL_MS);
};
