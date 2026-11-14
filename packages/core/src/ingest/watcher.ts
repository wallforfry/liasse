import { type FSWatcher, watch } from 'node:fs';
import { createWakeSignal } from '../jobs/wake-signal.ts';
import { isFileNotFound } from '../storage/node-errors.ts';
import { listWatchedFiles } from './watch-files.ts';
import { createVisitor, type WatchedFile } from './watch-visitor.ts';

export interface WatcherOptions {
  /** `config.pipeline.watchDir`. The watcher does nothing when it is undefined. */
  readonly dir: string | undefined;
  /** Typically `ingestFile` with the source `watch`. Rejections are reported, not thrown. */
  readonly ingest: (file: WatchedFile) => Promise<unknown>;
  /** A file is read once its size and modification time held still for this long. */
  readonly stabilityMs?: number;
  /** Full rescans catch what file system events missed, and retry failed ingestions. */
  readonly rescanIntervalMs?: number;
  /** False on file systems that deliver no events (some network mounts): rescans only. */
  readonly fsEvents?: boolean;
  /** `path` is undefined when the directory itself could not be scanned or watched. */
  readonly onError?: (error: unknown, path: string | undefined) => void;
}

export interface Watcher {
  /** Resolves once the scan in progress, if any, is over. */
  readonly stop: () => Promise<void>;
}

const DEFAULT_STABILITY_MS = 2000;
const DEFAULT_RESCAN_INTERVAL_MS = 60_000;

/**
 * Ingests the files of a directory tree, those present at start and those that appear
 * later. The directory is only ever read: nothing in it is moved, renamed or deleted,
 * and what was already ingested is recognised by its hash at the next start.
 */
export const startWatcher = (options: WatcherOptions): Watcher => {
  const { dir } = options;
  if (dir === undefined) return { stop: () => Promise.resolve() };
  const stabilityMs = options.stabilityMs ?? DEFAULT_STABILITY_MS;
  const rescanIntervalMs = options.rescanIntervalMs ?? DEFAULT_RESCAN_INTERVAL_MS;
  const onError = options.onError ?? (() => undefined);
  const visitor = createVisitor({
    ingest: options.ingest,
    stabilityMs,
    retryDelayMs: rescanIntervalMs,
    onError,
  });
  const wake = createWakeSignal();
  let events: FSWatcher | undefined;
  let stopped = false;
  let settling = false;
  let changed = false;

  // Tried again at every scan while it is down: the directory may appear late, and a
  // watcher that reported an error is closed.
  const listenForEvents = (): void => {
    if (events !== undefined || options.fsEvents === false) return;
    try {
      const started = watch(dir, { recursive: true }, () => {
        changed = true;
        // While files settle, scans already follow each other at the stability delay.
        if (!settling) wake.notify();
      });
      started.on('error', (error) => {
        onError(error, undefined);
        started.close();
        events = undefined;
      });
      events = started;
    } catch (error) {
      // The scan that follows reports a missing directory itself.
      if (!isFileNotFound(error)) onError(error, undefined);
    }
  };

  const scan = async (): Promise<void> => {
    listenForEvents();
    const paths = await listWatchedFiles(dir);
    visitor.keepOnly(paths);
    for (const path of paths) {
      if (stopped) return;
      await visitor.visit(path).catch((error: unknown) => {
        onError(error, path);
      });
    }
  };

  const run = async (): Promise<void> => {
    while (!stopped) {
      await scan().catch((error: unknown) => {
        onError(error, undefined);
      });
      // An event ignored during a settling scan may be about a file that scan did not
      // list: one more scan follows before the watcher goes idle.
      settling = visitor.hasSettlingFiles() || changed;
      changed = false;
      await wake.wait(settling ? stabilityMs : rescanIntervalMs);
    }
  };

  const running = run();
  return {
    stop: async () => {
      stopped = true;
      wake.notify();
      await running;
      events?.close();
    },
  };
};
