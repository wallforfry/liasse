import {
  type SecretUpdate,
  type Settings,
  type SettingsDraft,
  settingsSchema,
  type SettingsView,
} from '@liasse/contract';
import type { z } from 'zod';

const keyAfter = (update: SecretUpdate, stored: string | undefined): string | undefined => {
  switch (update.action) {
    case 'keep':
      return stored;
    case 'replace':
      return update.value;
    case 'clear':
      return undefined;
  }
};

/**
 * The settings a draft leads to, its keys applied to the stored ones and checked against
 * the whole schema: a key a provider needs may be kept, but not left absent.
 */
export const settingsFromDraft = (
  draft: SettingsDraft,
  stored: Settings | undefined,
): z.ZodSafeParseResult<Settings> =>
  settingsSchema.safeParse({
    llm: { ...draft.llm, api_key: keyAfter(draft.llm.api_key, stored?.llm.api_key) },
    embedding: {
      ...draft.embedding,
      api_key: keyAfter(draft.embedding.api_key, stored?.embedding.api_key),
    },
    pipeline: draft.pipeline,
    hindsight: {
      ...draft.hindsight,
      api_key: keyAfter(draft.hindsight.api_key, stored?.hindsight.api_key),
    },
  });

/** The settings as they may be shown: whether each key is set, never the key. */
export const settingsViewOf = ({ llm, embedding, pipeline, hindsight }: Settings): SettingsView => {
  const { api_key: llmKey, ...llmView } = llm;
  const { api_key: embeddingKey, ...embeddingView } = embedding;
  const { api_key: hindsightKey, ...hindsightView } = hindsight;
  return {
    llm: { ...llmView, api_key_set: llmKey !== undefined },
    embedding: { ...embeddingView, api_key_set: embeddingKey !== undefined },
    pipeline,
    hindsight: { ...hindsightView, api_key_set: hindsightKey !== undefined },
  };
};

/** Whether two settings embed with the same model, so vectors already stored stay valid. */
export const sameEmbedder = (left: Settings, right: Settings): boolean =>
  left.embedding.provider === right.embedding.provider &&
  left.embedding.model === right.embedding.model;
