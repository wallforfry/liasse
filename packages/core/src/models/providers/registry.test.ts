import { LLM_PROVIDERS } from '@liasse/contract/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createProviderEmbedder } from './embedder.ts';
import { PROVIDERS } from './registry.ts';
import {
  type StubResponse,
  type StubServer,
  startStubServer,
} from '../../testing/provider-stub-server.ts';
import { createTextModel } from './text-model.ts';
import { NATIVE_GENERATION } from './native.fixture.ts';
import {
  embeddingConfig,
  embeddings,
  llmConfig,
  SYNTHETIC_API_KEY,
} from '../../testing/provider-wire.ts';

const OUTPUT = { decision: 'existing' };

const TEXTS = ['energy bill', 'payslip'];
const VECTORS = [
  [1, 0, 0],
  [0, 1, 0],
];

const EMBEDDING = {
  openai: {
    path: '/v1/embeddings',
    response: embeddings(VECTORS),
    body: { model: 'embedding-model', input: TEXTS, dimensions: 3 },
    withoutKey: undefined,
  },
  mistral: {
    path: '/v1/embeddings',
    response: embeddings(VECTORS),
    body: { model: 'embedding-model', input: TEXTS },
    withoutKey: 'output_dimension',
  },
  gemini: {
    path: '/v1/models/embedding-model:batchEmbedContents',
    response: { body: { embeddings: VECTORS.map((values) => ({ values })) } },
    body: {
      requests: [
        { outputDimensionality: 3, taskType: 'RETRIEVAL_DOCUMENT' },
        { outputDimensionality: 3, taskType: 'RETRIEVAL_DOCUMENT' },
      ],
    },
    withoutKey: undefined,
  },
} as const;

const servers: StubServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const start = async (response: StubResponse): Promise<StubServer> => {
  const server = await startStubServer(() => response);
  servers.push(server);
  return server;
};

describe('provider registry', () => {
  it('has an adapter for every LLM provider of the configuration', () => {
    expect(Object.keys(PROVIDERS).toSorted()).toEqual([...LLM_PROVIDERS].toSorted());
  });

  it.each(['anthropic', 'openai', 'mistral', 'gemini'] as const)(
    'generates an object through the %s wire format',
    async (provider) => {
      const { path, credential, resolvedModel, respond } = NATIVE_GENERATION[provider];
      const server = await start({ body: respond(OUTPUT) });
      const model = createTextModel(
        llmConfig({
          LLM_PROVIDER: provider,
          LLM_API_KEY: SYNTHETIC_API_KEY,
          LLM_BASE_URL: `${server.url}/v1`,
        }),
      );
      expect(
        await model.generateObject({
          schema: z.strictObject({ decision: z.enum(['existing', 'new']) }),
          system: 'Classify.',
          prompt: 'An energy bill.',
        }),
      ).toEqual({ object: OUTPUT, model: resolvedModel });
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toMatchObject({ path, headers: credential });
      expect(server.requests[0]?.path).not.toContain(SYNTHETIC_API_KEY);
    },
  );

  it.each(['openai', 'mistral', 'gemini'] as const)(
    'embeds through the %s wire format',
    async (provider) => {
      const { path, response, body, withoutKey } = EMBEDDING[provider];
      const server = await start(response);
      const embedder = await createProviderEmbedder(
        embeddingConfig({
          EMBEDDING_PROVIDER: provider,
          EMBEDDING_API_KEY: SYNTHETIC_API_KEY,
          EMBEDDING_BASE_URL: `${server.url}/v1`,
          EMBEDDING_DIM: '3',
        }),
      );
      expect(await embedder.embed(TEXTS, 'passage')).toEqual(VECTORS);
      expect(server.requests[0]).toMatchObject({ path, body });
      if (withoutKey !== undefined) expect(server.requests[0]?.body).not.toHaveProperty(withoutKey);
    },
  );

  it('asks Gemini for query embeddings when the texts are queries', async () => {
    const server = await start(EMBEDDING.gemini.response);
    const embedder = await createProviderEmbedder(
      embeddingConfig({
        EMBEDDING_PROVIDER: 'gemini',
        EMBEDDING_API_KEY: SYNTHETIC_API_KEY,
        EMBEDDING_BASE_URL: `${server.url}/v1`,
        EMBEDDING_DIM: '3',
      }),
    );
    await embedder.embed(TEXTS, 'query');
    expect(server.requests[0]).toMatchObject({
      body: { requests: [{ taskType: 'RETRIEVAL_QUERY' }, { taskType: 'RETRIEVAL_QUERY' }] },
    });
  });

  it('refuses an openai-compatible endpoint without a base URL', async () => {
    await expect(
      PROVIDERS['openai-compatible'].languageModel(
        { apiKey: undefined, baseUrl: undefined },
        'text-model',
      ),
    ).rejects.toThrow('The openai-compatible provider needs a base URL');
  });
});
