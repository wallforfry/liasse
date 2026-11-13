export { createFakeEmbedder, type FakeEmbedderOptions } from './fake-embedder.ts';
export {
  createFakeTextModel,
  type FakeTextHandler,
  type FakeTextModel,
  type FakeTextRequest,
  type FakeTextScript,
} from './fake-text-model.ts';
export {
  createFakeVisionModel,
  type FakeVisionHandler,
  type FakeVisionModel,
} from './fake-vision-model.ts';
export { type DocumentRow, insertSyntheticDocument, type NewDocumentRow } from './fixtures.ts';
export { SYNTHETIC_ENV } from './synthetic-env.ts';
export {
  createTestDatabase,
  DEFAULT_TEST_DATABASE_URL,
  TEST_EMBEDDING_DIM,
  type TestDatabase,
  type TestDatabaseOptions,
} from './test-database.ts';
