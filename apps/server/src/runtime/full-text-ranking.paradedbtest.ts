import { chunks, documentPages } from '@liasse/core/db';
import { indexDocument } from '@liasse/core/search';
import {
  createFakeEmbedder,
  insertSyntheticDocument,
  type StubServer,
  TEST_EMBEDDING_DIM,
} from '@liasse/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startModelStub } from '../model-stub.test-helper.ts';
import { useRuntimeHarness } from './runtime.test-helper.ts';

const resultsSchema = z.object({ results: z.array(z.object({ title: z.string().nullable() })) });

// A server started on a database where ParadeDB pg_search is installed answers /search with
// the BM25 order, which `ts_rank_cd` reverses here: it counts the occurrences of the term and
// ignores the length of the chunk.
describe('the runtime on a database with pg_search', () => {
  const harness = useRuntimeHarness();
  let models: StubServer;

  beforeAll(async () => {
    models = await startModelStub(TEST_EMBEDDING_DIM);
  });

  afterAll(async () => {
    await models.close();
  });

  const addDocument = async (title: string, text: string): Promise<void> => {
    const { db } = harness.database();
    const { id } = await insertSyntheticDocument(db, { title, status: 'indexed' });
    await db.insert(documentPages).values({ documentId: id, page: 1, text });
    await indexDocument({ db, embedder: createFakeEmbedder() }, id);
  };

  it('ranks the full-text side of /search with BM25', async () => {
    const runtime = await harness.start(
      { EMBEDDING_DIM: String(TEST_EMBEDDING_DIM) },
      {},
      { embedding: { provider: 'ollama', model: 'embedding-model', base_url: models.url } },
    );
    expect(harness.lines().some((line) => line.startsWith('Full text is ranked by BM25'))).toBe(
      true,
    );
    const filler = Array.from({ length: 150 }, (_, index) => `filler${String(index)}`).join(' ');
    await addDocument('quartz-long', `quartz ${filler} quartz`);
    await addDocument('quartz-short', 'quartz crystal');
    // Without embeddings the vector side ranks nothing, so the order is the full-text one.
    await harness.database().db.update(chunks).set({ embedding: null });

    const response = await harness.call(runtime, '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'quartz' }),
    });
    expect(response.status).toBe(200);
    const { results } = resultsSchema.parse(await response.json());
    expect(results.map(({ title }) => title)).toEqual(['quartz-short', 'quartz-long']);
  });
});
