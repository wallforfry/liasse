import { settingsDraftSchema } from '@liasse/contract';
import { describe, expect, it } from 'vitest';
import { syntheticSettings } from '../testing/synthetic-settings.ts';
import { sameEmbedder, settingsFromDraft, settingsViewOf } from './draft.ts';

const STORED = syntheticSettings({ llm: { provider: 'anthropic', api_key: 'stored-key-9b2c' } });

const draftOf = (apiKey: unknown) =>
  settingsDraftSchema.parse({
    llm: {
      provider: 'anthropic',
      text_model: 'text-model',
      vision_model: 'vision-model',
      ...(apiKey === undefined ? {} : { api_key: apiKey }),
    },
  });

describe('settingsFromDraft', () => {
  it('keeps the stored key by default', () => {
    const result = settingsFromDraft(draftOf(undefined), STORED);
    expect(result.success && result.data.llm.api_key).toBe('stored-key-9b2c');
  });

  it('replaces the key with the value sent', () => {
    const result = settingsFromDraft(draftOf({ action: 'replace', value: 'new-key-9b2c' }), STORED);
    expect(result.success && result.data.llm.api_key).toBe('new-key-9b2c');
  });

  it('refuses to clear a key the provider needs, and keeping one that was never stored', () => {
    expect(settingsFromDraft(draftOf({ action: 'clear' }), STORED).success).toBe(false);
    expect(settingsFromDraft(draftOf(undefined), undefined).success).toBe(false);
  });
});

describe('settingsViewOf', () => {
  it('says whether each key is set, and never holds one', () => {
    const view = settingsViewOf(STORED);
    expect(view.llm.api_key_set).toBe(true);
    expect(view.embedding.api_key_set).toBe(false);
    expect(view.hindsight.api_key_set).toBe(false);
    expect(JSON.stringify(view)).not.toContain('stored-key-9b2c');
  });
});

describe('sameEmbedder', () => {
  it('compares the provider and the model, nothing else', () => {
    const local = syntheticSettings();
    expect(sameEmbedder(local, syntheticSettings({ embedding: { timeout_ms: 5000 } }))).toBe(true);
    expect(
      sameEmbedder(local, syntheticSettings({ embedding: { model: 'Xenova/other-model' } })),
    ).toBe(false);
    expect(
      sameEmbedder(local, syntheticSettings({ embedding: { provider: 'ollama', model: 'm' } })),
    ).toBe(false);
  });
});
