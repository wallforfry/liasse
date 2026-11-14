import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicJsonText, NATIVE_GENERATION } from './native-fixtures.ts';
import { type StubServer, startStubServer } from './stub-server.ts';
import { createTextModel } from './text-model.ts';
import { chatCompletion, llmConfig, SYNTHETIC_API_KEY } from './wire-fixtures.ts';

// The shapes the specification mandates for extraction: optional core fields, a nullable
// value, a format the strict modes do not know, and `extra` with free keys.
const specShaped = z.object({
  issuer: z.string().optional(),
  amount: z.number().nullable(),
  site: z.url().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});
const OUTPUT = { amount: null, extra: { customer_no: '42' } };

const SCHEMA_SENT = {
  type: 'object',
  properties: {
    issuer: { type: 'string' },
    site: { type: 'string', format: 'uri' },
    extra: { type: 'object', additionalProperties: { type: 'string' } },
  },
  required: ['amount'],
};

const servers: StubServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const bodyOf = async (
  responseBody: unknown,
  env: Readonly<Record<string, string>>,
  schema: z.ZodType = specShaped,
): Promise<unknown> => {
  const server = await startStubServer(() => ({ body: responseBody }));
  servers.push(server);
  const model = createTextModel(
    llmConfig({ LLM_API_KEY: SYNTHETIC_API_KEY, LLM_BASE_URL: `${server.url}/v1`, ...env }),
  );
  await model.generateObject({ schema, system: 'Extract.', prompt: 'An energy bill.' });
  return server.requests[0]?.body;
};

describe('a schema with optional and free-key properties', () => {
  it('reaches OpenAI without strict mode, which would refuse it', async () => {
    const body = await bodyOf(NATIVE_GENERATION.openai.respond(OUTPUT), { LLM_PROVIDER: 'openai' });
    expect(body).toMatchObject({
      text: { format: { type: 'json_schema', strict: false, schema: SCHEMA_SENT } },
    });
    expect(body).not.toHaveProperty('text.format.schema.$schema');
  });

  it.each([
    ['openai-compatible', {}],
    ['ollama', { LLM_API_KEY: '' }],
  ])('reaches an %s server without strict mode', async (provider, env) => {
    const body = await bodyOf(chatCompletion(JSON.stringify(OUTPUT)).body, {
      LLM_PROVIDER: provider,
      ...env,
    });
    expect(body).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { strict: false, schema: SCHEMA_SENT },
      },
    });
    expect(body).not.toHaveProperty('response_format.json_schema.schema.$schema');
  });

  it('reaches Mistral without strict mode', async () => {
    const body = await bodyOf(NATIVE_GENERATION.mistral.respond(OUTPUT), {
      LLM_PROVIDER: 'mistral',
    });
    expect(body).toMatchObject({
      response_format: { json_schema: { strict: false, schema: SCHEMA_SENT } },
    });
  });

  it('reaches Gemini as responseJsonSchema, without the $schema keyword', async () => {
    const body = await bodyOf(NATIVE_GENERATION.gemini.respond(OUTPUT), {
      LLM_PROVIDER: 'gemini',
    });
    expect(body).toMatchObject({ generationConfig: { responseJsonSchema: SCHEMA_SENT } });
    expect(body).not.toHaveProperty('generationConfig.responseJsonSchema.$schema');
  });

  it('reaches a current Anthropic model through the JSON tool, not native structured outputs', async () => {
    const body = await bodyOf(NATIVE_GENERATION.anthropic.respond(OUTPUT), {
      LLM_PROVIDER: 'anthropic',
      TEXT_MODEL: 'claude-sonnet-4-5',
    });
    expect(body).toMatchObject({
      model: 'claude-sonnet-4-5',
      tools: [{ name: 'json', input_schema: SCHEMA_SENT }],
      tool_choice: { type: 'any' },
    });
    expect(body).not.toHaveProperty('output_config');
  });
});

describe('a closed schema on a current Anthropic model', () => {
  it('uses native structured outputs, without the keywords Anthropic refuses', async () => {
    const closed = z.strictObject({
      decision: z.enum(['existing', 'new']),
      confidence: z.number().min(0).max(1),
    });
    const body = await bodyOf(
      anthropicJsonText({ decision: 'existing', confidence: 0.9 }),
      { LLM_PROVIDER: 'anthropic', TEXT_MODEL: 'claude-sonnet-4-5' },
      closed,
    );
    expect(body).toMatchObject({
      model: 'claude-sonnet-4-5',
      output_config: {
        format: {
          type: 'json_schema',
          schema: { type: 'object', required: ['decision', 'confidence'] },
        },
      },
    });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('output_config.format.schema.properties.confidence.minimum');
  });
});
