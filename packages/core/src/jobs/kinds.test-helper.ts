import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { jobs } from '../db/schema/jobs.ts';
import { defineJobKind } from './kinds.ts';

// Kinds that exist for the tests of the queue only; real kinds belong to their feature.
export const labelJob = defineJobKind({
  name: 'test_label',
  schema: z.object({ label: z.string().min(1) }),
});

export const otherJob = defineJobKind({
  name: 'test_other',
  schema: z.object({ label: z.string().min(1) }),
});

export const singleAttemptJob = defineJobKind({
  name: 'test_single_attempt',
  schema: z.object({ label: z.string().min(1) }),
  maxAttempts: 1,
});

export type JobRow = typeof jobs.$inferSelect;

export const jobById = async (db: Database, id: string): Promise<JobRow> => {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (job === undefined) throw new Error(`The job ${id} does not exist`);
  return job;
};
