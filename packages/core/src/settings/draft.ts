import {
  type SecretUpdate,
  type Settings,
  type SettingsDraft,
  settingsSchema,
  type SettingsView,
} from '@liasse/contract';
import { KEY_FIELDS, SECRET_SLOTS, stateOfKey, type StoredKey, type StoredKeys } from './keys.ts';

export interface SettingsIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

export type DraftOutcome =
  | { readonly ok: true; readonly settings: Settings }
  | { readonly ok: false; readonly issues: readonly SettingsIssue[] };

/** The key an update leads to; undefined for a kept key that cannot be read. */
export const keyAfter = (
  update: SecretUpdate,
  stored: StoredKey,
): { readonly key?: string } | undefined => {
  switch (update.action) {
    case 'replace':
      return { key: update.value };
    case 'clear':
      return {};
    case 'keep':
      if (stored.state === 'unreadable') return undefined;
      return stored.state === 'set' ? { key: stored.value } : {};
  }
};

export const UNREADABLE_KEPT =
  'cannot be kept: it was saved under another AUTH_SECRET and does not decrypt; replace or ' +
  'clear it';

/**
 * The settings a draft leads to, its keys applied to the stored ones and checked against
 * the whole schema: a key a provider needs may be kept, but not left absent, and a key
 * that does not decrypt may be replaced or cleared, never kept.
 */
export const settingsFromDraft = (draft: SettingsDraft, stored: StoredKeys): DraftOutcome => {
  const keys = {
    llm: keyAfter(draft.llm.api_key, stored.llm),
    embedding: keyAfter(draft.embedding.api_key, stored.embedding),
    hindsight: keyAfter(draft.hindsight.api_key, stored.hindsight),
    google: keyAfter(draft.google.client_secret, stored.google),
  };
  const kept = SECRET_SLOTS.filter((slot) => keys[slot] === undefined);
  if (kept.length > 0) {
    return {
      ok: false,
      issues: kept.map((slot) => ({ path: [slot, KEY_FIELDS[slot]], message: UNREADABLE_KEPT })),
    };
  }
  const parsed = settingsSchema.safeParse({
    llm: { ...draft.llm, api_key: keys.llm?.key },
    embedding: { ...draft.embedding, api_key: keys.embedding?.key },
    pipeline: draft.pipeline,
    hindsight: { ...draft.hindsight, api_key: keys.hindsight?.key },
    google: { ...draft.google, client_secret: keys.google?.key },
  });
  return parsed.success
    ? { ok: true, settings: parsed.data }
    : { ok: false, issues: parsed.error.issues };
};

/** The settings as they may be shown: the state of each key, never the key. */
export const settingsViewOf = (
  { llm, embedding, pipeline, hindsight, google }: SettingsDraft,
  keys: StoredKeys,
): SettingsView => {
  const { api_key: _llmKey, ...llmView } = llm;
  const { api_key: _embeddingKey, ...embeddingView } = embedding;
  const { api_key: _hindsightKey, ...hindsightView } = hindsight;
  const { client_secret: _googleSecret, ...googleView } = google;
  return {
    llm: { ...llmView, api_key_state: stateOfKey(keys.llm) },
    embedding: { ...embeddingView, api_key_state: stateOfKey(keys.embedding) },
    pipeline,
    hindsight: { ...hindsightView, api_key_state: stateOfKey(keys.hindsight) },
    google: { ...googleView, client_secret_state: stateOfKey(keys.google) },
  };
};

interface WithEmbedder {
  readonly embedding: { readonly provider: string; readonly model?: string | undefined };
}

/** Whether two settings embed with the same model, so vectors already stored stay valid. */
export const sameEmbedder = (left: WithEmbedder, right: WithEmbedder): boolean =>
  left.embedding.provider === right.embedding.provider &&
  left.embedding.model === right.embedding.model;
