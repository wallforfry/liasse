import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { createFsStorage } from '../storage/fs.ts';
import type { Storage } from '../storage/port.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { IngestDeps } from './ingest-file.ts';

export const TEST_MAX_FILE_SIZE = 64 * 1024;

export interface IngestHarness {
  readonly database: TestDatabase;
  readonly storage: Storage;
  readonly deps: IngestDeps;
  /** How many times the storage was asked to write a file. */
  readonly puts: () => number;
  readonly storedFiles: () => Promise<readonly string[]>;
  readonly reset: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

// A real database and the real fs driver under a temporary root.
export const createIngestHarness = async (): Promise<IngestHarness> => {
  const database = await createTestDatabase();
  const root = await mkdtemp(join(tmpdir(), 'liasse-ingest-'));
  const fsStorage = createFsStorage(root);
  let puts = 0;
  const storage: Storage = {
    ...fsStorage,
    put: (key, bytes) => {
      puts += 1;
      return fsStorage.put(key, bytes);
    },
  };

  const storedFiles = async (): Promise<readonly string[]> => {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  };

  return {
    database,
    storage,
    deps: { db: database.db, storage, maxFileSize: TEST_MAX_FILE_SIZE },
    puts: () => puts,
    storedFiles,
    reset: async () => {
      await database.db.delete(jobs);
      await database.db.delete(documents);
      await rm(root, { recursive: true, force: true });
      await mkdir(root);
      puts = 0;
    },
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
      await database.dispose();
    },
  };
};
