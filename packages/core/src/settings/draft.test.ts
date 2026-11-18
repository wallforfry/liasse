import { settingsDraftSchema } from '@liasse/contract';
import { describe, expect, it } from 'vitest';
import { syntheticSettings } from '../testing/synthetic-settings.ts';
import { sameEmbedder, settingsFromDraft, settingsViewOf } from './draft.ts';
import { keysOf, NO_KEYS, type StoredKeys } from './keys.ts';

const STORED = syntheticSettings({ llm: { provider: 'anthropic', api_key: 'stored-key-9b2c' } });
const UNREADABLE: StoredKeys = { ...NO_KEYS, llm: { state: 'unreadable' } };

const draftOf = (apiKey: unknown) =>
  settingsDraftSchema.parse({
    llm: {
      provider: 'anthropic',
      text_model: 'text-model',
      vision_model: 'vision-model',
      ...(apiKey === undefined ? {} : { api_key: apiKey }),
    },
  });

const keyOf = (outcome: ReturnType<typeof settingsFromDraft>) =>
  outcome.ok ? outcome.settings.llm.api_key : outcome.issues.map(({ path }) => path.join('.'));

describe('settingsFromDraft', () => {
  it('keeps the stored key by default', () => {
    expect(keyOf(settingsFromDraft(draftOf(undefined), keysOf(STORED)))).toBe('stored-key-9b2c');
  });

  it('replaces the key with the value sent', () => {
    const replaced = draftOf({ action: 'replace', value: 'new-key-9b2c' });
    expect(keyOf(settingsFromDraft(replaced, keysOf(STORED)))).toBe('new-key-9b2c');
  });

  it('refuses to clear a key the provider needs, and keeping one that was never stored', () => {
    expect(settingsFromDraft(draftOf({ action: 'clear' }), keysOf(STORED)).ok).toBe(false);
    expect(settingsFromDraft(draftOf(undefined), NO_KEYS).ok).toBe(false);
  });

  it('refuses to keep a key that does not decrypt, and replaces it without reading it', () => {
    expect(keyOf(settingsFromDraft(draftOf(undefined), UNREADABLE))).toEqual(['llm.api_key']);
    const replaced = draftOf({ action: 'replace', value: 'new-key-9b2c' });
    expect(keyOf(settingsFromDraft(replaced, UNREADABLE))).toBe('new-key-9b2c');
  });
});

describe('settingsViewOf', () => {
  it('gives the state of each key, and never holds one', () => {
    const view = settingsViewOf(draftOf(undefined), {
      ...keysOf(STORED),
      hindsight: UNREADABLE.llm,
    });
    expect(view.llm.api_key_state).toBe('set');
    expect(view.embedding.api_key_state).toBe('unset');
    expect(view.hindsight.api_key_state).toBe('unreadable');
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

describe('the Google client of the settings', () => {
  const withGoogle = (google: unknown) =>
    settingsDraftSchema.parse({
      llm: { provider: 'ollama', text_model: 'text-model', vision_model: 'vision-model' },
      google,
    });

  it('needs its secret with its client id, and gives only the state of the secret', () => {
    const missing = settingsFromDraft(withGoogle({ client_id: 'client.synthetic' }), NO_KEYS);
    expect(missing.ok ? [] : missing.issues.map(({ path }) => path.join('.'))).toEqual([
      'google.client_secret',
    ]);
    const draft = withGoogle({
      client_id: 'client.synthetic',
      client_secret: { action: 'replace', value: 'client-secret-9b2c' },
    });
    const outcome = settingsFromDraft(draft, NO_KEYS);
    expect(outcome.ok ? outcome.settings.google : undefined).toEqual({
      client_id: 'client.synthetic',
      client_secret: 'client-secret-9b2c',
    });
    const view = settingsViewOf(draft, outcome.ok ? keysOf(outcome.settings) : NO_KEYS);
    expect(view.google).toEqual({ client_id: 'client.synthetic', client_secret_state: 'set' });
    expect(JSON.stringify(view)).not.toContain('client-secret-9b2c');
  });
});
