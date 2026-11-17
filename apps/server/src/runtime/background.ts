import type { Database } from '@liasse/core/db';
import { ingestFile, startWatcher } from '@liasse/core/ingest';
import { type HandlerSet, startWorkers } from '@liasse/core/jobs';
import type { Storage } from '@liasse/core/storage';
import { describeError, type Logger } from '../log.ts';
import type { ShutdownStep } from '../shutdown.ts';

interface QueueOptions {
  readonly db: Database;
  /** `WORKERS`. */
  readonly concurrency: number;
  /** Read at every claim: the handlers of the settings in force. */
  readonly handlers: () => HandlerSet;
  readonly logger: Logger;
  /** How long jobs in progress may take to finish at shutdown before they are aborted. */
  readonly graceMs: number;
}

/** Starts the workers of the job queue. Resolves to the step that drains them. */
export const startQueue = async ({
  db,
  concurrency,
  handlers,
  logger,
  graceMs,
}: QueueOptions): Promise<ShutdownStep> => {
  const workers = await startWorkers({
    db,
    handlers,
    concurrency,
    onJobFailed: ({ job, error, willRetry }) => {
      logger.event('job_failed', {
        job_id: job.id,
        kind: job.kind,
        attempt: job.attempt,
        will_retry: willRetry,
        ...describeError(error),
      });
    },
    // Not a failure: the job waits for a state that settles on its own.
    onJobDeferred: ({ job, error, delayMs }) => {
      logger.event('job_deferred', {
        job_id: job.id,
        kind: job.kind,
        attempt: job.attempt,
        delay_ms: delayMs,
        ...describeError(error.cause ?? error),
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
  /** `WATCH_DIR`; nothing is watched when it is undefined. */
  readonly dir: string | undefined;
  /** Read for every file: the limit of the settings in force. */
  readonly maxFileSize: () => number;
  readonly logger: Logger;
}

/** Watches `WATCH_DIR` when it is set. The step stops the scan in progress. */
export const startFolder = ({
  db,
  storage,
  dir,
  maxFileSize,
  logger,
}: FolderOptions): ShutdownStep => {
  const watcher = startWatcher({
    dir,
    ingest: (file) =>
      ingestFile({ db, storage, maxFileSize: maxFileSize() }, { ...file, source: 'watch' }),
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
