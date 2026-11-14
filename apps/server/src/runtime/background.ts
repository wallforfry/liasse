import type { Config } from '@liasse/core/config';
import type { Database } from '@liasse/core/db';
import { ingestFile, startWatcher } from '@liasse/core/ingest';
import { startWorkers } from '@liasse/core/jobs';
import type { Storage } from '@liasse/core/storage';
import { describeError, type Logger } from '../log.ts';
import type { ShutdownStep } from '../shutdown.ts';
import type { Bindings } from './bindings.ts';

interface QueueOptions {
  readonly db: Database;
  readonly config: Config;
  readonly bindings: Pick<Bindings, 'handlers' | 'perKindConcurrency'>;
  readonly logger: Logger;
  /** How long jobs in progress may take to finish at shutdown before they are aborted. */
  readonly graceMs: number;
}

/** Starts the workers of the job queue. Resolves to the step that drains them. */
export const startQueue = async ({
  db,
  config,
  bindings,
  logger,
  graceMs,
}: QueueOptions): Promise<ShutdownStep> => {
  const workers = await startWorkers({
    db,
    handlers: bindings.handlers,
    concurrency: config.pipeline.workers,
    perKindConcurrency: bindings.perKindConcurrency,
    onJobFailed: ({ job, error, willRetry }) => {
      logger.event('job_failed', {
        job_id: job.id,
        kind: job.kind,
        attempt: job.attempt,
        will_retry: willRetry,
        ...describeError(error),
      });
    },
    onError: (error) => {
      logger.event('queue_error', describeError(error));
    },
  });
  return {
    name: 'workers',
    run: async () => {
      const { aborted, abandoned } = await workers.stop({ timeoutMs: graceMs });
      if (aborted.length + abandoned.length === 0) return;
      // An aborted job is back in the queue; an abandoned one is taken back once its
      // lock expires. Neither is lost.
      logger.event('jobs_interrupted', { aborted: aborted.length, abandoned: abandoned.length });
    },
  };
};

interface FolderOptions {
  readonly db: Database;
  readonly storage: Storage;
  readonly config: Config;
  readonly logger: Logger;
}

/** Watches `WATCH_DIR` when it is set. The step stops the scan in progress. */
export const startFolder = ({ db, storage, config, logger }: FolderOptions): ShutdownStep => {
  const ingest = { db, storage, maxFileSize: config.pipeline.maxFileSize };
  const watcher = startWatcher({
    dir: config.pipeline.watchDir,
    ingest: (file) => ingestFile(ingest, { ...file, source: 'watch' }),
    // The path is left out: the name of a file may say what the document is.
    onError: (error, path) => {
      logger.event('watch_problem', {
        scope: path === undefined ? 'folder' : 'file',
        ...describeError(error),
      });
    },
  });
  return { name: 'watcher', run: watcher.stop };
};
