import { jobs } from '../db/schema/jobs.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { enqueue } from './enqueue.ts';
import { jobById, labelJob } from './kinds.test-helper.ts';
import { startWorkers, type Workers, type WorkersOptions } from './workers.ts';

export type StartOptions = Omit<WorkersOptions, 'db' | 'concurrency'> & {
  readonly concurrency?: number;
};

export interface WorkersHarness {
  readonly database: TestDatabase;
  /** Workers on the test database, with intervals short enough for a test. */
  readonly start: (options: StartOptions) => Promise<Workers>;
  readonly queue: (label: string) => Promise<string>;
  readonly statusOf: (id: string) => Promise<string>;
  /** Stops every worker started through the harness, then empties the queue. */
  readonly reset: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

export const aborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve();
    });
  });

export const createWorkersHarness = async (): Promise<WorkersHarness> => {
  const database = await createTestDatabase();
  const started: Workers[] = [];

  return {
    database,
    start: async (options) => {
      const workers = await startWorkers({
        db: database.db,
        concurrency: 2,
        pollIntervalMs: 20,
        maxPollIntervalMs: 40,
        retry: { baseMs: 10, maxMs: 20 },
        ...options,
      });
      started.push(workers);
      return workers;
    },
    queue: (label) => enqueue(database.db, { kind: labelJob, payload: { label } }),
    statusOf: async (id) => (await jobById(database.db, id)).status,
    reset: async () => {
      await Promise.all(
        started.splice(0).map((workers) => workers.stop({ timeoutMs: 0, abortGraceMs: 500 })),
      );
      await database.db.delete(jobs);
    },
    dispose: () => database.dispose(),
  };
};
