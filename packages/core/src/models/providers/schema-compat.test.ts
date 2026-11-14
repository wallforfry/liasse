import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classificationSchema } from '../../pipeline/classify/classification-schema.ts';
import { extractionOutputSchema } from '../../pipeline/extract/extraction-schema.ts';
import { anthropicJsonText, NATIVE_GENERATION } from './native.fixture.ts';
import { type StubServer, startStubServer } from '../../testing/provider-stub-server.ts';
import { createTextModel } from './text-model.ts';
import { chatCompletion, llmConfig, SYNTHETIC_API_KEY } from '../../testing/provider-wire.ts';

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

const EXTRACTION_OUTPUT = {
  title: 'Synthetic energy bill',
  core: { reference: { value: 'SYN-1', page: 1, quote: 'Invoice SYN-1', confidence: 0.9 } },
  fields: {},
  extra: {},
};

const EVIDENCE_KEYS = ['value', 'page', 'quote', 'confidence'];

const chatBody = (output: unknown): unknown => chatCompletion(JSON.stringify(output)).body;

// Where each provider carries the schema, in the body it receives.
const PIPELINE_SCHEMA_CASES = [
  ['openai', { LLM_PROVIDER: 'openai' }, NATIVE_GENERATION.openai.respond, 'text.format.schema'],
  [
    'openai-compatible',
    { LLM_PROVIDER: 'openai-compatible' },
    chatBody,
    'response_format.json_schema.schema',
  ],
  [
    'ollama',
    { LLM_PROVIDER: 'ollama', LLM_API_KEY: '' },
    chatBody,
    'response_format.json_schema.schema',
  ],
  [
    'mistral',
    { LLM_PROVIDER: 'mistral' },
    NATIVE_GENERATION.mistral.respond,
    'response_format.json_schema.schema',
  ],
  [
    'gemini',
    { LLM_PROVIDER: 'gemini' },
    NATIVE_GENERATION.gemini.respond,
    'generationConfig.responseJsonSchema',
  ],
  [
    'anthropic',
    { LLM_PROVIDER: 'anthropic', TEXT_MODEL: 'claude-sonnet-4-5' },
    NATIVE_GENERATION.anthropic.respond,
    'tools.0.input_schema',
  ],
] as const;

describe('the extraction schema of the pipeline', () => {
  const schema = extractionOutputSchema({
    meter_id: { type: 'identifier', format: 'PDL' },
    parties: { type: 'list', items: { type: 'entity' } },
  });

  it.each(PIPELINE_SCHEMA_CASES)(
    'reaches %s whole, without the defaults of its lenient elements',
    async (_provider, env, respond, path) => {
      const body = await bodyOf(respond(EXTRACTION_OUTPUT), env, schema);
      expect(body).toHaveProperty(
        `${path}.properties.core.properties.issuer.required`,
        EVIDENCE_KEYS,
      );
      expect(body).toHaveProperty(
        `${path}.properties.fields.properties.parties.items.required`,
        EVIDENCE_KEYS,
      );
      expect(body).toHaveProperty(
        `${path}.properties.extra.additionalProperties.required`,
        EVIDENCE_KEYS,
      );
      expect(body).not.toHaveProperty(`${path}.properties.core.required`);
      expect(JSON.stringify(body)).not.toContain('"default"');
    },
  );
});

describe('the classification schema of the pipeline', () => {
  it.each(PIPELINE_SCHEMA_CASES)(
    'reaches %s with the offered slugs as an enumeration',
    async (_provider, env, respond) => {
      const body = await bodyOf(
        respond({ decision: 'existing', slug: 'energy_bill', confidence: 0.9 }),
        env,
        classificationSchema(['energy_bill', 'payslip']),
      );
      expect(JSON.stringify(body)).toContain('"enum":["energy_bill","payslip"]');
    },
  );
});
