import { describe, expect, it } from 'vitest';
import { settingsDraftSchema, settingsSchema } from './settings.ts';

const MODELS = { text_model: 'text-model', vision_model: 'vision-model' } as const;
const LOCAL_LLM = { provider: 'ollama', ...MODELS } as const;

const issuesOf = (input: unknown): readonly string[] => {
  const result = settingsSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
};

describe('the settings schema', () => {
  it('fills every default of a minimal document', () => {
    expect(settingsSchema.parse({ llm: LOCAL_LLM })).toEqual({
      llm: { ...LOCAL_LLM, timeout_ms: 300_000 },
      embedding: { provider: 'local', timeout_ms: 60_000 },
      pipeline: {
        max_file_size: 52_428_800,
        auto_apply: 'safe',
        confidence_threshold: 0.7,
        max_new_types_per_day: 5,
        schema_language: 'en',
        max_vision_pages: 100,
        entity_attach_similarity: 1,
        entity_arbitration_similarity: 0.8,
      },
      hindsight: { bank: 'documents' },
    });
  });

  it('asks for a key from a provider that needs one, and from no other', () => {
    expect(issuesOf({ llm: MODELS })).toEqual(['llm.api_key: required when provider is anthropic']);
    expect(issuesOf({ llm: { ...MODELS, api_key: 'synthetic-key' } })).toEqual([]);
    expect(issuesOf({ llm: LOCAL_LLM })).toEqual([]);
    expect(
      issuesOf({ llm: LOCAL_LLM, embedding: { provider: 'openai', model: 'embedding-model' } }),
    ).toEqual(['embedding.api_key: required when provider is openai']);
  });

  it('asks for a base URL from openai-compatible', () => {
    expect(issuesOf({ llm: { ...MODELS, provider: 'openai-compatible' } })).toEqual([
      'llm.base_url: required when provider is openai-compatible',
    ]);
    expect(
      issuesOf({
        llm: LOCAL_LLM,
        embedding: { provider: 'openai-compatible', model: 'embedding-model' },
      }),
    ).toEqual(['embedding.base_url: required when provider is openai-compatible']);
  });

  it('refuses a base URL that carries credentials or a query', () => {
    expect(
      issuesOf({ llm: { ...LOCAL_LLM, base_url: 'http://user:secret@ollama:11434' } }),
    ).toHaveLength(1);
    expect(issuesOf({ llm: { ...LOCAL_LLM, base_url: 'http://ollama:11434?x=1' } })).toHaveLength(
      1,
    );
  });

  it('asks for a model from a remote embedder, and refuses a window for the local one', () => {
    expect(issuesOf({ llm: LOCAL_LLM, embedding: { provider: 'ollama' } })).toEqual([
      'embedding.model: required when provider is ollama',
    ]);
    expect(issuesOf({ llm: LOCAL_LLM, embedding: { max_input_tokens: 512 } })).toEqual([
      'embedding.max_input_tokens: only applies to a remote provider',
    ]);
  });

  it('keeps the arbitration threshold at or under the attach threshold', () => {
    expect(
      issuesOf({
        llm: LOCAL_LLM,
        pipeline: { entity_attach_similarity: 0.9, entity_arbitration_similarity: 0.95 },
      }),
    ).toEqual([
      'pipeline.entity_arbitration_similarity: must not be above entity_attach_similarity',
    ]);
  });

  it('refuses a key it does not know, so a typo is never ignored', () => {
    expect(issuesOf({ llm: LOCAL_LLM, pipeline: { confidence_treshold: 0.5 } })).toHaveLength(1);
  });
});

describe('the settings draft', () => {
  it('keeps every key by default and leaves the rule of a required key to the server', () => {
    const draft = settingsDraftSchema.parse({ llm: MODELS });
    expect(draft.llm.api_key).toEqual({ action: 'keep' });
    expect(draft.embedding.api_key).toEqual({ action: 'keep' });
    expect(draft.hindsight.api_key).toEqual({ action: 'keep' });
  });

  it('applies the rules that hold whatever the keys are', () => {
    expect(
      settingsDraftSchema.safeParse({ llm: { ...MODELS, provider: 'openai-compatible' } }).success,
    ).toBe(false);
    expect(
      settingsDraftSchema.safeParse({
        llm: { ...MODELS, api_key: { action: 'replace', value: '' } },
      }).success,
    ).toBe(false);
  });
});
