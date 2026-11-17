import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelListError } from '../errors.ts';
import {
  type StubHandler,
  type StubServer,
  startStubServer,
} from '../../testing/provider-stub-server.ts';
import { SYNTHETIC_API_KEY } from '../../testing/provider-wire.ts';
import { MAX_LISTED_MODELS } from '@liasse/contract/domain';
import { listModels, MAX_MODEL_LIST_PAGES, MODEL_LIST_TIMEOUT_MS } from './list-models.ts';
import type { ModelPurpose } from './model-catalog.ts';
import type { ModelProvider } from './registry.ts';

const servers: StubServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const serve = async (handler: StubHandler): Promise<StubServer> => {
  const server = await startStubServer(handler);
  servers.push(server);
  return server;
};

const list = (
  provider: ModelProvider,
  baseUrl: string,
  purpose: ModelPurpose = 'language',
  timeoutMs?: number,
) => listModels({ provider, endpoint: { apiKey: SYNTHETIC_API_KEY, baseUrl }, purpose, timeoutMs });

const failureOf = async (listing: Promise<unknown>): Promise<ModelListError> => {
  const error: unknown = await listing.catch((caught: unknown) => caught);
  if (!(error instanceof ModelListError)) throw new Error('expected a ModelListError');
  return error;
};

const OPENAI_LIST = { data: [{ id: 'model-b' }, { id: 'model-a' }] };

const WIRES = [
  {
    provider: 'anthropic',
    suffix: '/v1',
    path: '/v1/models?limit=1000',
    header: ['x-api-key', SYNTHETIC_API_KEY],
    body: { data: [{ id: 'model-b' }, { id: 'model-a' }], has_more: false, last_id: 'model-a' },
  },
  {
    provider: 'openai',
    suffix: '/v1',
    path: '/v1/models',
    header: ['authorization', `Bearer ${SYNTHETIC_API_KEY}`],
    body: OPENAI_LIST,
  },
  {
    provider: 'mistral',
    suffix: '/v1',
    path: '/v1/models',
    header: ['authorization', `Bearer ${SYNTHETIC_API_KEY}`],
    body: OPENAI_LIST,
  },
  {
    provider: 'gemini',
    suffix: '/v1beta',
    path: '/v1beta/models?pageSize=1000',
    header: ['x-goog-api-key', SYNTHETIC_API_KEY],
    body: { models: [{ name: 'models/model-b' }, { name: 'models/model-a' }] },
  },
  {
    provider: 'ollama',
    suffix: '',
    path: '/api/tags',
    header: ['authorization', `Bearer ${SYNTHETIC_API_KEY}`],
    body: { models: [{ name: 'model-b' }, { name: 'model-a' }] },
  },
  {
    provider: 'openai-compatible',
    suffix: '/v1',
    path: '/v1/models',
    header: ['authorization', `Bearer ${SYNTHETIC_API_KEY}`],
    body: OPENAI_LIST,
  },
] as const satisfies readonly {
  readonly provider: ModelProvider;
  readonly suffix: string;
  readonly path: string;
  readonly header: readonly [string, string];
  readonly body: unknown;
}[];

describe('listModels', () => {
  it.each(WIRES)(
    'reads the list of $provider at its path, with its key',
    async ({ provider, suffix, path, header, body }) => {
      const server = await serve(() => ({ body }));

      await expect(list(provider, `${server.url}${suffix}`)).resolves.toEqual([
        'model-a',
        'model-b',
      ]);
      expect(server.requests.map((request) => request.path)).toEqual([path]);
      expect(server.requests[0]?.headers[header[0]]).toBe(header[1]);
    },
  );

  it('reads the root of an Ollama server from a base URL that names its /v1', async () => {
    const server = await serve(() => ({ body: { models: [{ name: 'llama:8b' }] } }));

    await expect(list('ollama', `${server.url}/v1/`)).resolves.toEqual(['llama:8b']);
    expect(server.requests[0]?.path).toBe('/api/tags');
  });

  it('follows the pages of Anthropic', async () => {
    const server = await serve((_request, index) => ({
      body:
        index === 0
          ? { data: [{ id: 'model-a' }], has_more: true, last_id: 'model-a' }
          : { data: [{ id: 'model-b' }], has_more: false, last_id: 'model-b' },
    }));

    await expect(list('anthropic', `${server.url}/v1`)).resolves.toEqual(['model-a', 'model-b']);
    expect(server.requests[1]?.path).toBe('/v1/models?limit=1000&after_id=model-a');
  });

  it('follows the pages of Gemini and keeps the models of the purpose', async () => {
    const pages = [
      {
        models: [
          { name: 'models/chat', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedder', supportedGenerationMethods: ['embedContent'] },
        ],
        nextPageToken: 'second',
      },
      {
        models: [
          { name: 'models/both', supportedGenerationMethods: ['generateContent', 'embedContent'] },
        ],
      },
    ];
    const server = await serve((request) => ({
      body: request.path.includes('pageToken=second') ? pages[1] : pages[0],
    }));

    await expect(list('gemini', `${server.url}/v1beta`, 'language')).resolves.toEqual([
      'both',
      'chat',
    ]);
    await expect(list('gemini', `${server.url}/v1beta`, 'embedding')).resolves.toEqual([
      'both',
      'embedder',
    ]);
  });

  it('leaves out of the language models of Mistral those it says do not chat', async () => {
    const server = await serve(() => ({
      body: {
        data: [
          { id: 'chat', capabilities: { completion_chat: true } },
          { id: 'embedder', capabilities: { completion_chat: false } },
        ],
      },
    }));

    await expect(list('mistral', `${server.url}/v1`, 'language')).resolves.toEqual(['chat']);
    await expect(list('mistral', `${server.url}/v1`, 'embedding')).resolves.toEqual([
      'chat',
      'embedder',
    ]);
  });

  it('drops duplicates and ids that cannot be a model id', async () => {
    const server = await serve(() => ({
      body: {
        data: [
          { id: 'model-a' },
          { id: 'model-a' },
          { id: ' padded' },
          { id: 'line\nbreak' },
          { id: '' },
          { id: 'x'.repeat(201) },
        ],
      },
    }));

    await expect(list('openai', `${server.url}/v1`)).resolves.toEqual(['model-a']);
  });

  it('reports a refusal with its status and the error code of the provider', async () => {
    const server = await serve(() => ({
      status: 401,
      body: { error: { type: 'authentication_error', message: `bad key ${SYNTHETIC_API_KEY}` } },
    }));

    const error = await failureOf(list('anthropic', `${server.url}/v1`));
    expect(error).toMatchObject({
      failure: 'rejected',
      statusCode: 401,
      code: 'authentication_error',
    });
    expect(error.message).not.toContain(SYNTHETIC_API_KEY);
  });

  it('reports an answer that is not a list of models', async () => {
    const server = await serve(() => ({ body: { models: 'none' } }));

    await expect(failureOf(list('openai', `${server.url}/v1`))).resolves.toMatchObject({
      failure: 'invalid_answer',
    });
  });

  it('refuses a redirect, which would carry the key to another origin', async () => {
    const target = await serve(() => ({ body: OPENAI_LIST }));
    const server = await serve(() => ({
      status: 302,
      headers: { location: `${target.url}/v1/models` },
      body: {},
    }));

    await expect(failureOf(list('anthropic', `${server.url}/v1`))).resolves.toMatchObject({
      failure: 'unreachable',
    });
    expect(target.requests).toEqual([]);
  });

  it('reports a server that does not answer', async () => {
    const server = await serve(() => ({ body: OPENAI_LIST }));
    const { url } = server;
    await server.close();
    servers.splice(servers.indexOf(server), 1);

    await expect(failureOf(list('openai', `${url}/v1`))).resolves.toMatchObject({
      failure: 'unreachable',
      code: 'ECONNREFUSED',
    });
  });

  it('reports a deadline passed before the answer', async () => {
    const server = await serve(() => undefined);

    await expect(
      failureOf(list('openai', `${server.url}/v1`, 'language', 50)),
    ).resolves.toMatchObject({ failure: 'timeout' });
  });

  it('gives a listing 15 seconds unless told otherwise', async () => {
    const server = await serve(() => ({ body: OPENAI_LIST }));
    const deadline = vi.spyOn(AbortSignal, 'timeout');
    try {
      await listModels({
        provider: 'openai',
        endpoint: { apiKey: SYNTHETIC_API_KEY, baseUrl: `${server.url}/v1` },
        purpose: 'language',
      });
      await list('openai', `${server.url}/v1`, 'language', 50);
      expect(deadline.mock.calls).toEqual([[MODEL_LIST_TIMEOUT_MS], [50]]);
      expect(MODEL_LIST_TIMEOUT_MS).toBe(15_000);
    } finally {
      deadline.mockRestore();
    }
  });

  it('stops following pages at its page limit', async () => {
    const server = await serve((_request, index) => ({
      body: {
        data: [{ id: `model-${String(index).padStart(3, '0')}` }],
        has_more: true,
        last_id: `model-${String(index)}`,
      },
    }));

    const ids = await list('anthropic', `${server.url}/v1`);
    expect(server.requests).toHaveLength(MAX_MODEL_LIST_PAGES);
    expect(ids).toHaveLength(MAX_MODEL_LIST_PAGES);
  });

  it('cuts a list longer than the contract accepts, after sorting it', async () => {
    const count = MAX_LISTED_MODELS + 5;
    const ids = Array.from(
      { length: count },
      (_, index) => `model-${String(count - index).padStart(5, '0')}`,
    );
    const server = await serve(() => ({ body: { data: ids.map((id) => ({ id })) } }));

    const listed = await list('openai', `${server.url}/v1`);
    expect(listed).toHaveLength(MAX_LISTED_MODELS);
    expect(listed[0]).toBe('model-00001');
    expect(listed.at(-1)).toBe(`model-${String(MAX_LISTED_MODELS).padStart(5, '0')}`);
  });
});
