import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createProviderEmbedder, createTextModel, createVisionModel } from '../index.ts';
import { once } from './lazy.ts';
import { type StubServer, startStubServer } from './stub-server.ts';
import { chatCompletion, embeddingConfig, embeddings, llmConfig } from './wire-fixtures.ts';

// Importing a forbidden package fails the test: only the configured provider may load.
const { loads, forbidden } = vi.hoisted(() => ({
  loads: { sdk: 0 },
  forbidden: (name: string) => () => {
    throw new Error(`${name} must not be loaded`);
  },
}));

vi.mock('ai', async (importOriginal) => {
  loads.sdk += 1;
  return importOriginal();
});

vi.mock('@ai-sdk/anthropic', forbidden('@ai-sdk/anthropic'));
vi.mock('@ai-sdk/openai', forbidden('@ai-sdk/openai'));
vi.mock('@ai-sdk/mistral', forbidden('@ai-sdk/mistral'));
vi.mock('@ai-sdk/google', forbidden('@ai-sdk/google'));

const servers: StubServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('lazy loading', () => {
  it('loads the AI SDK and the configured provider package on the first call only', async () => {
    const server = await startStubServer(({ path }) =>
      path.endsWith('/embeddings') ? embeddings([[1, 0, 0]]) : chatCompletion('{"title":"Bill"}'),
    );
    servers.push(server);
    const llm = llmConfig({ LLM_PROVIDER: 'ollama', LLM_BASE_URL: server.url });
    const text = createTextModel(llm);
    const vision = createVisionModel(llm);
    const embedder = await createProviderEmbedder(
      embeddingConfig({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_BASE_URL: server.url,
        EMBEDDING_DIM: '3',
      }),
    );
    expect(loads.sdk).toBe(0);

    await text.generateObject({
      schema: z.object({ title: z.string() }),
      system: 'Title the document.',
      prompt: 'An energy bill.',
    });
    await vision.transcribePage({
      image: new Uint8Array([1]),
      mime: 'image/png',
      prompt: 'Transcribe the page.',
    });
    await embedder.embed(['energy bill'], 'passage');
    expect(loads.sdk).toBe(1);
    expect(server.requests).toHaveLength(3);
  });
});

describe('once', () => {
  it('runs the loader a single time and shares its result', async () => {
    const load = vi.fn(() => Promise.resolve({}));
    const loadOnce = once(load);
    expect(load).not.toHaveBeenCalled();
    expect(await loadOnce()).toBe(await loadOnce());
    expect(load).toHaveBeenCalledTimes(1);
  });
});
