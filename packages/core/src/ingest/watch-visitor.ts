import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { isFileNotFound } from '../storage/node-errors.ts';
import { IngestError } from './errors.ts';
import { fingerprintOf } from './watch-files.ts';
import { decide, forgetAbsent, type WatchState } from './watch-state.ts';

export interface WatchedFile {
  readonly stream: AsyncIterable<Uint8Array>;
  readonly filename: string;
}

export interface VisitorOptions {
  readonly ingest: (file: WatchedFile) => Promise<unknown>;
  readonly stabilityMs: number;
  readonly retryDelayMs: number;
  readonly onError: (error: unknown, path: string) => void;
}

export interface Visitor {
  /** Looks at one file and ingests it when it is due. Rejects only on an unexpected stat error. */
  readonly visit: (path: string) => Promise<void>;
  /** Forgets the paths that are no longer listed. */
  readonly keepOnly: (paths: readonly string[]) => void;
  readonly hasSettlingFiles: () => boolean;
}

// The file is opened when the consumer starts reading, and closed when it stops. A
// stream opened ahead would leak its descriptor to a consumer that never reads, and
// would raise an unhandled `error` event if the file vanished meanwhile.
const contentOf = (path: string): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    const chunks: AsyncIterable<unknown> = createReadStream(path);
    for await (const chunk of chunks) {
      if (chunk instanceof Uint8Array) yield chunk;
    }
  },
});

export const createVisitor = ({
  ingest,
  stabilityMs,
  retryDelayMs,
  onError,
}: VisitorOptions): Visitor => {
  const states = new Map<string, WatchState>();

  // A file that vanishes while it is read is simply no longer there: not an error.
  const ingestPath = async (path: string, fingerprint: string): Promise<void> => {
    try {
      await ingest({ stream: contentOf(path), filename: basename(path) });
      states.set(path, { phase: 'handled', fingerprint });
    } catch (error) {
      if (isFileNotFound(error)) {
        states.delete(path);
        return;
      }
      onError(error, path);
      states.set(
        path,
        error instanceof IngestError
          ? { phase: 'handled', fingerprint }
          : { phase: 'failed', fingerprint, retryAt: Date.now() + retryDelayMs },
      );
    }
  };

  return {
    visit: async (path) => {
      const fingerprint = await fingerprintOf(path);
      if (fingerprint === undefined) {
        states.delete(path);
        return;
      }
      const decision = decide(states.get(path), fingerprint, Date.now(), stabilityMs);
      if (decision.ingest) await ingestPath(path, fingerprint);
      else states.set(path, decision.state);
    },
    keepOnly: (paths) => {
      forgetAbsent(states, paths);
    },
    hasSettlingFiles: () => [...states.values()].some(({ phase }) => phase === 'settling'),
  };
};
