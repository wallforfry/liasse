import { afterEach, describe, expect, it } from 'vitest';
import { EmbeddingDimensionError, ModelProviderError } from '../errors.ts';
import type { Embedder } from '../ports.ts';
import { createProviderEmbedder, MAX_TEXTS_PER_REQUEST } from './embedder.ts';
import type { HostResolver } from './locality.ts';
import { type StubHandler, type StubServer, startStubServer } from './stub-server.ts';
import {
  embeddingConfig,
  embeddingInputOf,
  embeddings,
  failure,
  indexedEmbeddings,
  SYNTHETIC_API_KEY,
} from './wire-fixtures.ts';

// The DNS of the test: a Compose service on a private address, a public name.
const resolveHost: HostResolver = (hostname) =>
  hostname === 'ollama'
    ? Promise.resolve(['172.18.0.5'])
    : hostname.endsWith('.example.com')
      ? Promise.resolve(['203.0.113.7'])
      : Promise.reject(new Error(`ENOTFOUND ${hostname}`));

const servers: StubServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

// Each text is a number, echoed as the first coordinate of its three-dimensional vector.
const echo: StubHandler = (request) =>
  embeddings(embeddingInputOf(request).map((text) => [Number(text), 0, 0]));

const start = async (
  handler: StubHandler,
  env: Readonly<Record<string, string>> = {},
): Promise<{ readonly server: StubServer; readonly embedder: Embedder }> => {
  const server = await startStubServer(handler);
  servers.push(server);
  const embedder = await createProviderEmbedder(
    embeddingConfig({
      EMBEDDING_PROVIDER: 'openai-compatible',
      EMBEDDING_BASE_URL: `${server.url}/v1`,
      EMBEDDING_API_KEY: SYNTHETIC_API_KEY,
      EMBEDDING_DIM: '3',
      ...env,
    }),
  );
  return { server, embedder };
};

const failureOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (error: unknown) => error,
  );

describe('createProviderEmbedder', () => {
  it('states the input window it was configured with, and none otherwise', async () => {
    const { embedder: unbounded } = await start(echo);
    expect(unbounded.maxInputTokens).toBeUndefined();
    const { embedder: bounded } = await start(echo, { EMBEDDING_MAX_INPUT_TOKENS: '512' });
    expect(bounded.maxInputTokens).toBe(512);
    expect(bounded.countTokens).toBeUndefined();
  });

  it('describes itself from the configuration', async () => {
    const { embedder } = await start(echo);
    expect(embedder).toMatchObject({ dimension: 3, model: 'embedding-model' });
  });

  it('returns one embedding per text, in order', async () => {
    const { server, embedder } = await start(echo);
    expect(await embedder.embed(['7', '8'], 'passage')).toEqual([
      [7, 0, 0],
      [8, 0, 0],
    ]);
    expect(server.requests[0]).toMatchObject({
      path: '/v1/embeddings',
      headers: { authorization: `Bearer ${SYNTHETIC_API_KEY}` },
      body: { model: 'embedding-model', input: ['7', '8'] },
    });
  });

  it('splits the texts into sequential requests and keeps their order', async () => {
    const { server, embedder } = await start(echo);
    const texts = Array.from({ length: 2 * MAX_TEXTS_PER_REQUEST + 22 }, (_, index) =>
      String(index),
    );
    const vectors = await embedder.embed(texts, 'passage');
    expect(vectors.map(([first]) => first)).toEqual(texts.map(Number));
    expect(server.requests.map((request) => embeddingInputOf(request).length)).toEqual([
      MAX_TEXTS_PER_REQUEST,
      MAX_TEXTS_PER_REQUEST,
      22,
    ]);
  });

  it('puts the embeddings back in the order of the texts when the reply is shuffled', async () => {
    const { embedder } = await start((request) => {
      const vectors = embeddingInputOf(request).map((text) => [Number(text), 0, 0]);
      return indexedEmbeddings(vectors.map((embedding, index) => ({ index, embedding })).reverse());
    });
    expect(await embedder.embed(['7', '8', '9'], 'passage')).toEqual([
      [7, 0, 0],
      [8, 0, 0],
      [9, 0, 0],
    ]);
  });

  it('refuses a reply whose indexes do not name each text once', async () => {
    const { embedder } = await start(() =>
      indexedEmbeddings([
        { index: 1, embedding: [7, 0, 0] },
        { index: 1, embedding: [8, 0, 0] },
      ]),
    );
    const error = await failureOf(embedder.embed(['7', '8'], 'passage'));
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({ code: 'embedding_index', retryable: false });
  });

  it('makes no request for an empty list', async () => {
    const { server, embedder } = await start(echo);
    expect(await embedder.embed([], 'query')).toEqual([]);
    expect(server.requests).toHaveLength(0);
  });

  it('refuses vectors whose dimension differs from EMBEDDING_DIM', async () => {
    const { embedder } = await start(echo, { EMBEDDING_DIM: '384' });
    const error = await failureOf(embedder.embed(['1'], 'passage'));
    expect(error).toBeInstanceOf(EmbeddingDimensionError);
    expect(error).toMatchObject({
      expected: 384,
      actual: 3,
      message:
        'Embedding model embedding-model returned vectors of 3 dimensions, but EMBEDDING_DIM is 384. ' +
        'Choose a model that produces 384 dimensions, or install a new database with EMBEDDING_DIM=3.',
    });
  });

  it('refuses a response that does not hold one embedding per text', async () => {
    const { embedder } = await start(() => embeddings([[1, 0, 0]]));
    const error = await failureOf(embedder.embed(['1', '2'], 'passage'));
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({ retryable: false, code: 'AI_InvalidResponseDataError' });
  });

  it('retries a transient failure', async () => {
    const { server, embedder } = await start((request, index) =>
      index === 0 ? failure(503, 'overloaded') : echo(request, index),
    );
    expect(await embedder.embed(['4'], 'query')).toEqual([[4, 0, 0]]);
    expect(server.requests).toHaveLength(2);
  });

  it('fails with a retryable error when the provider does not answer in time', async () => {
    const { embedder } = await start(() => undefined, { EMBEDDING_TIMEOUT: '50ms' });
    const error = await failureOf(embedder.embed(['1'], 'passage'));
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({
      retryable: true,
      code: 'timeout',
      message: 'Provider openai-compatible failed for model embedding-model (timeout)',
    });
  });

  it('reaches Ollama through the /v1 API of its server root', async () => {
    const { server, embedder } = await start(echo, {
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_API_KEY: '',
      EMBEDDING_BASE_URL: '',
    });
    const atServer = await createProviderEmbedder(
      embeddingConfig({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_BASE_URL: server.url,
        EMBEDDING_DIM: '3',
      }),
    );
    expect(embedder.isLocal).toBe(true);
    expect(await atServer.embed(['5'], 'query')).toEqual([[5, 0, 0]]);
    expect(server.requests[0]?.path).toBe('/v1/embeddings');
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
    expect(server.requests[0]?.body).not.toHaveProperty('dimensions');
  });

  it.each([
    ['ollama', {}, true],
    ['ollama', { EMBEDDING_BASE_URL: 'http://ollama:11434' }, true],
    ['ollama', { EMBEDDING_BASE_URL: 'https://ollama.example.com' }, false],
    ['openai-compatible', { EMBEDDING_BASE_URL: 'http://192.168.1.20:8000/v1' }, true],
    ['openai-compatible', { EMBEDDING_BASE_URL: 'https://api.example.com/v1' }, false],
    ['openai', { EMBEDDING_API_KEY: SYNTHETIC_API_KEY }, false],
    [
      'openai',
      { EMBEDDING_API_KEY: SYNTHETIC_API_KEY, EMBEDDING_BASE_URL: 'http://127.0.0.1:4000/v1' },
      false,
    ],
    ['mistral', { EMBEDDING_API_KEY: SYNTHETIC_API_KEY }, false],
    ['gemini', { EMBEDDING_API_KEY: SYNTHETIC_API_KEY }, false],
  ])('%s with %j is local: %j', async (provider, env, isLocal) => {
    const embedder = await createProviderEmbedder(
      embeddingConfig({ EMBEDDING_PROVIDER: provider, ...env }),
      { resolveHost },
    );
    expect(embedder.isLocal).toBe(isLocal);
  });

  it('is not local when the host of its endpoint does not resolve', async () => {
    const embedder = await createProviderEmbedder(
      embeddingConfig({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_BASE_URL: 'http://unknown.example:11434',
      }),
      { resolveHost },
    );
    expect(embedder.isLocal).toBe(false);
  });
});
