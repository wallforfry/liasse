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
export { buildSyntheticDocx, syntheticDocumentXml } from './synthetic-docx.ts';
export { SYNTHETIC_ENV } from './synthetic-env.ts';
export {
  buildSyntheticPdf,
  type SyntheticPdfOptions,
  type SyntheticPdfPage,
} from './synthetic-pdf.ts';
export { buildSyntheticPng } from './synthetic-png.ts';
export { buildSyntheticZip, type SyntheticZipEntry } from './synthetic-zip.ts';
export {
  createTestDatabase,
  DEFAULT_TEST_DATABASE_URL,
  TEST_EMBEDDING_DIM,
  type TestDatabase,
  type TestDatabaseOptions,
} from './test-database.ts';
