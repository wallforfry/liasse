import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docTypes } from '../db/schema/registry.ts';
import { renderTypeSchema } from '../registry/stored-schema.ts';
import { seedCorpus, type SeededCorpus } from '../search/corpus.fixture.ts';
import { rankByFullText } from '../search/rankers.ts';
import { createFsStorage } from '../storage/fs.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { ApiContext } from './context.ts';
import type { ApiFeatures } from './features.ts';
import { createFileUrls } from './file-url.ts';

export const TEST_MAX_FILE_SIZE = 64 * 1024;
export const TEST_PUBLIC_URL = 'https://liasse.example.com';
export const TEST_FILE_URL_SECRET = 'synthetic-file-url-secret-0123456789';

export interface ApiHarness {
  readonly database: TestDatabase;
  readonly context: ApiContext;
  readonly corpus: SeededCorpus;
  readonly withFeatures: (features: ApiFeatures) => ApiContext;
  readonly dispose: () => Promise<void>;
}

// A real database holding the search corpus, and the real fs driver under a temporary root.
export const createApiHarness = async (): Promise<ApiHarness> => {
  const database = await createTestDatabase();
  const root = await mkdtemp(join(tmpdir(), 'liasse-api-'));
  const embedder = createFakeEmbedder();
  const corpus = await seedCorpus(database.db, embedder);
  // The corpus inserts its types around the registry, with the empty schema of the column.
  await database.db.update(docTypes).set({ schema: renderTypeSchema({}) });
  const context: ApiContext = {
    db: database.db,
    storage: createFsStorage(root),
    embedder,
    fullText: rankByFullText,
    schemaLanguage: 'en',
    maxFileSize: TEST_MAX_FILE_SIZE,
    fileUrls: createFileUrls({ secret: TEST_FILE_URL_SECRET, publicUrl: TEST_PUBLIC_URL }),
    features: {},
  };
  return {
    database,
    context,
    corpus,
    withFeatures: (features) => ({ ...context, features }),
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
      await database.dispose();
    },
  };
};
