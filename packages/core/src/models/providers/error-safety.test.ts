import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ModelOutputError, ModelProviderError } from '../errors.ts';
import { createProviderEmbedder } from './embedder.ts';
import { type StubHandler, type StubServer, startStubServer } from './stub-server.ts';
import { createTextModel } from './text-model.ts';
import { createVisionModel } from './vision-model.ts';
import {
  chatCompletion,
  embeddingConfig,
  failure,
  llmConfig,
  SYNTHETIC_API_KEY,
} from './wire-fixtures.ts';

// Stands for document content: it must never reach an error, whatever the provider or
// the model sends back.
const SENSITIVE = 'IBAN FR76 3000 synthetic 0001';
const MARKER = 'FR76';

const schema = z.strictObject({
  decision: z.enum(['existing', 'new']),
  confidence: z.number().min(0).max(1),
  extra: z.record(z.string(), z.string()),
});

// A server that quotes the whole request, credentials included, in its error message.
const echoing: StubHandler = ({ headers, body }) =>
  failure(
    400,
    `cannot process ${JSON.stringify(body)} sent with ${String(headers.authorization)}`,
    'invalid_request_error',
  );

const servers: StubServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const start = async (handler: StubHandler) => {
  const server = await startStubServer(handler);
  servers.push(server);
  const llm = llmConfig({
    LLM_PROVIDER: 'openai-compatible',
    LLM_BASE_URL: `${server.url}/v1`,
    LLM_API_KEY: SYNTHETIC_API_KEY,
  });
  const embedder = await createProviderEmbedder(
    embeddingConfig({
      EMBEDDING_PROVIDER: 'openai-compatible',
      EMBEDDING_BASE_URL: `${server.url}/v1`,
      EMBEDDING_API_KEY: SYNTHETIC_API_KEY,
    }),
  );
  return { text: createTextModel(llm), vision: createVisionModel(llm), embedder };
};

const failureOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (error: unknown) => error,
  );

const everythingIn = (error: unknown): string =>
  inspect(error, { depth: Infinity, showHidden: true });

const expectSafeProviderError = (error: unknown, model: string): void => {
  expect(error).toBeInstanceOf(ModelProviderError);
  expect(error).toMatchObject({
    statusCode: 400,
    code: 'invalid_request_error',
    retryable: false,
    message: `Provider openai-compatible failed for model ${model} (HTTP 400, invalid_request_error)`,
  });
  expect(error).not.toHaveProperty('cause');
  expect(everythingIn(error)).not.toContain(MARKER);
  expect(everythingIn(error)).not.toContain(SYNTHETIC_API_KEY);
};

describe('a provider that echoes the request in its error', () => {
  it('leaves no document text or key in a text model failure', async () => {
    const { text } = await start(echoing);
    const error = await failureOf(
      text.generateObject({ schema, system: 'Classify.', prompt: SENSITIVE }),
    );
    expectSafeProviderError(error, 'text-model');
  });

  it('leaves no page content or key in a vision model failure', async () => {
    const { vision } = await start(echoing);
    const error = await failureOf(
      vision.transcribePage({
        image: new TextEncoder().encode(SENSITIVE),
        mime: 'image/png',
        prompt: `Transcribe. ${SENSITIVE}`,
      }),
    );
    expectSafeProviderError(error, 'vision-model');
  });

  it('leaves no embedded text or key in an embedder failure', async () => {
    const { embedder } = await start(echoing);
    const error = await failureOf(embedder.embed([SENSITIVE], 'passage'));
    expectSafeProviderError(error, 'embedding-model');
  });

  it('drops an error type that is not a short identifier', async () => {
    const { text } = await start(() => failure(400, 'rejected', SENSITIVE));
    const error = await failureOf(
      text.generateObject({ schema, system: 'Classify.', prompt: 'An energy bill.' }),
    );
    expect(error).toMatchObject({
      code: undefined,
      message: 'Provider openai-compatible failed for model text-model (HTTP 400)',
    });
    expect(everythingIn(error)).not.toContain(MARKER);
  });
});

describe('a model output that does not match the schema', () => {
  const generate = async (output: unknown): Promise<unknown> => {
    const { text } = await start(() => chatCompletion(JSON.stringify(output)));
    return failureOf(
      text.generateObject({ schema, system: 'Classify.', prompt: 'An energy bill.' }),
    );
  };

  it('reports the path and the code of each issue, never a received value', async () => {
    const error = await generate({ decision: SENSITIVE, confidence: 2, extra: { note: 7 } });
    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error).toHaveProperty(
      'message',
      'Model resolved-model-2026-01 returned an output that does not match the schema: ' +
        'decision: invalid_value; confidence: too_big; extra.note: invalid_type',
    );
    expect(error).not.toHaveProperty('cause');
    expect(everythingIn(error)).not.toContain(MARKER);
  });

  it('names an undeclared key only when it is a short identifier', async () => {
    const error = await generate({
      decision: 'new',
      confidence: 1,
      extra: { [SENSITIVE]: 7 },
      action: 'delete',
      [SENSITIVE]: 'x',
    });
    expect(error).toHaveProperty(
      'message',
      'Model resolved-model-2026-01 returned an output that does not match the schema: ' +
        'extra.?: invalid_type; (root): unrecognized_keys (action, ?)',
    );
    expect(everythingIn(error)).not.toContain(MARKER);
  });

  it('lists at most ten issues', async () => {
    const extra = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`k${String(index)}`, index]),
    );
    const error = await generate({ decision: 'new', confidence: 1, extra });
    expect(error).toHaveProperty(
      'message',
      expect.stringMatching(/extra\.k9: invalid_type; and 2 more$/),
    );
  });
});

describe('a model id reported by the provider', () => {
  it('is ignored when it is not an identifier', async () => {
    const { text } = await start(() =>
      chatCompletion('{"decision":"new","confidence":1,"extra":{}}', { model: SENSITIVE }),
    );
    const result = await text.generateObject({
      schema,
      system: 'Classify.',
      prompt: 'An energy bill.',
    });
    expect(result.model).toBe('text-model');
  });

  it('is ignored in an output error too', async () => {
    const { text } = await start(() => chatCompletion('not json', { model: SENSITIVE }));
    const error = await failureOf(
      text.generateObject({ schema, system: 'Classify.', prompt: 'An energy bill.' }),
    );
    expect(error).toMatchObject({ name: 'ModelOutputError', model: 'text-model' });
    expect(everythingIn(error)).not.toContain(MARKER);
  });
});
