import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ModelOutputError, ModelProviderError, OutputSchemaError } from '../errors.ts';
import type { TextModel } from '../ports.ts';
import {
  type StubHandler,
  type StubServer,
  startStubServer,
} from '../../testing/provider-stub-server.ts';
import { createTextModel } from './text-model.ts';
import {
  chatCompletion,
  failure,
  llmSettings,
  RESOLVED_MODEL,
  SYNTHETIC_API_KEY,
} from '../../testing/provider-wire.ts';

const classification = z.strictObject({
  decision: z.enum(['existing', 'new']),
  confidence: z.number().min(0).max(1),
});

const request = { schema: classification, system: 'Classify.', prompt: 'An energy bill.' };
const VALID_OUTPUT = '{"decision":"existing","confidence":0.9}';

const servers: StubServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const start = async (
  handler: StubHandler,
  env: Readonly<Record<string, unknown>> = {},
): Promise<{ readonly server: StubServer; readonly model: TextModel }> => {
  const server = await startStubServer(handler);
  servers.push(server);
  const model = createTextModel(
    llmSettings({
      provider: 'openai-compatible',
      base_url: `${server.url}/v1`,
      api_key: SYNTHETIC_API_KEY,
      ...env,
    }),
  );
  return { server, model };
};

const failureOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (error: unknown) => error,
  );

describe('createTextModel', () => {
  it('returns the object with the model id resolved by the provider', async () => {
    const { server, model } = await start(() => chatCompletion(VALID_OUTPUT));
    expect(await model.generateObject(request)).toEqual({
      object: { decision: 'existing', confidence: 0.9 },
      model: RESOLVED_MODEL,
    });
    expect(server.requests).toHaveLength(1);
  });

  it('sends the prompt, temperature 0 and the JSON Schema of the Zod schema', async () => {
    const { server, model } = await start(() => chatCompletion(VALID_OUTPUT));
    await model.generateObject(request);
    expect(server.requests[0]).toMatchObject({
      path: '/v1/chat/completions',
      headers: { authorization: `Bearer ${SYNTHETIC_API_KEY}` },
      body: {
        model: 'text-model',
        temperature: 0,
        messages: [
          { role: 'system', content: 'Classify.' },
          { role: 'user', content: 'An energy bill.' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            schema: {
              type: 'object',
              properties: {
                decision: { type: 'string', enum: ['existing', 'new'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['decision', 'confidence'],
              additionalProperties: false,
            },
          },
        },
      },
    });
  });

  it('rejects an output that does not match the schema', async () => {
    const { model } = await start(() => chatCompletion('{"decision":"maybe","confidence":2}'));
    const error = await failureOf(model.generateObject(request));
    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error).toMatchObject({ model: RESOLVED_MODEL });
    expect(error).toHaveProperty('message', expect.stringMatching(/decision.*confidence/));
  });

  it('rejects a key the strict schema does not declare', async () => {
    const { model } = await start(() =>
      chatCompletion('{"decision":"new","confidence":1,"action":"delete"}'),
    );
    await expect(model.generateObject(request)).rejects.toBeInstanceOf(ModelOutputError);
  });

  it('applies the transformations of the schema', async () => {
    const { model } = await start(() => chatCompletion('{"amount":"84.20"}'));
    const { object } = await model.generateObject({
      ...request,
      schema: z.object({ amount: z.string().transform(Number) }),
    });
    expect(object).toEqual({ amount: 84.2 });
  });

  it.each([
    ['is not JSON', chatCompletion('I cannot help with that.'), /not a JSON value/],
    ['is empty', chatCompletion(''), /not a JSON value/],
    ['is absent', chatCompletion(null), /not a JSON value/],
    ['is truncated', chatCompletion(VALID_OUTPUT, { finishReason: 'length' }), /truncated/],
    ['is cut short', chatCompletion('{"decision":"exi', { finishReason: 'length' }), /truncated/],
    ['is refused', chatCompletion(VALID_OUTPUT, { finishReason: 'content_filter' }), /refused/],
  ])('fails with ModelOutputError when the output %s', async (_case, response, reason) => {
    const { server, model } = await start(() => response);
    const error = await failureOf(model.generateObject(request));
    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error).toHaveProperty('message', expect.stringMatching(reason));
    expect(server.requests).toHaveLength(1);
  });

  it('fails with OutputSchemaError, before any request, for a schema without a JSON Schema form', async () => {
    const { server, model } = await start(() => chatCompletion(VALID_OUTPUT));
    const error = await failureOf(
      model.generateObject({ ...request, schema: z.object({ when: z.date() }) }),
    );
    expect(error).toBeInstanceOf(OutputSchemaError);
    expect(error).toHaveProperty(
      'message',
      expect.stringMatching(/^The output schema cannot be converted to JSON Schema: .*Date/),
    );
    expect(server.requests).toHaveLength(0);
  });

  it.each([429, 503])('retries after HTTP %d, then succeeds', async (status) => {
    const { server, model } = await start((_request, index) =>
      index < 2 ? failure(status, 'try again') : chatCompletion(VALID_OUTPUT),
    );
    expect((await model.generateObject(request)).object.decision).toBe('existing');
    expect(server.requests).toHaveLength(3);
  });

  it('gives up after two retries and reports a retryable failure', async () => {
    const { server, model } = await start(() => failure(503, 'overloaded'));
    const error = await failureOf(model.generateObject(request));
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({
      provider: 'openai-compatible',
      model: 'text-model',
      statusCode: 503,
      retryable: true,
      code: 'synthetic_error',
      message: 'Provider openai-compatible failed for model text-model (HTTP 503, synthetic_error)',
    });
    expect(server.requests).toHaveLength(3);
  });

  it('does not retry a request the provider rejects', async () => {
    const { server, model } = await start(() => failure(400, 'unknown model'));
    await expect(model.generateObject(request)).rejects.toMatchObject({
      name: 'ModelProviderError',
      statusCode: 400,
      retryable: false,
    });
    expect(server.requests).toHaveLength(1);
  });

  it('fails with a retryable error when the provider does not answer in time', async () => {
    const { model } = await start(() => undefined, { timeout_ms: 50 });
    const error = await failureOf(model.generateObject(request));
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({
      retryable: true,
      statusCode: undefined,
      code: 'timeout',
      message: 'Provider openai-compatible failed for model text-model (timeout)',
    });
  });

  it('does not call the provider when the signal is already aborted', async () => {
    const { server, model } = await start(() => chatCompletion(VALID_OUTPUT));
    await expect(
      model.generateObject({ ...request, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.requests).toHaveLength(0);
  });

  it('rejects with the abort reason when the signal aborts during the call', async () => {
    const controller = new AbortController();
    const reason = new Error('shutting down');
    const { model } = await start(() => {
      controller.abort(reason);
      return undefined;
    });
    expect(await failureOf(model.generateObject({ ...request, signal: controller.signal }))).toBe(
      reason,
    );
  });

  it('reaches Ollama through the /v1 API of its server root, without a key', async () => {
    const { server, model } = await start(() => chatCompletion(VALID_OUTPUT), {
      provider: 'ollama',
      api_key: undefined,
    });
    const withRoot = createTextModel(
      llmSettings({ provider: 'ollama', base_url: `${server.url}/` }),
    );
    expect((await model.generateObject(request)).object.decision).toBe('existing');
    expect((await withRoot.generateObject(request)).model).toBe(RESOLVED_MODEL);
    expect(server.requests.map(({ path }) => path)).toEqual([
      '/v1/chat/completions',
      '/v1/chat/completions',
    ]);
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
    expect(server.requests[0]).toMatchObject({
      body: { response_format: { type: 'json_schema' } },
    });
  });
});
