import { screen } from '@testing-library/react';
import { expect } from 'vitest';
import { type Answer, json, type Request } from '../../test/render.test-helper.tsx';

export const STATE = {
  version: 3,
  updated_at: '2026-11-16T09:00:00.000Z',
  settings: {
    llm: {
      provider: 'openai-compatible',
      base_url: 'http://models.example.test/v1',
      text_model: 'synthetic-text',
      vision_model: 'synthetic-vision',
      timeout_ms: 120_000,
      api_key_state: 'set',
    },
    embedding: { provider: 'local', timeout_ms: 60_000, api_key_state: 'unset' },
    pipeline: {
      max_file_size: 52_428_800,
      auto_apply: 'safe',
      confidence_threshold: 0.7,
      max_new_types_per_day: 5,
      schema_language: 'fr',
      max_vision_pages: 100,
      entity_attach_similarity: 1,
      entity_arbitration_similarity: 0.8,
    },
    hindsight: { url: 'http://hindsight.example.test', bank: 'documents', api_key_state: 'unset' },
    google: { client_secret_state: 'unset' },
  },
  embedder_locked: false,
};

export const OK_CHECK = {
  text_model: { status: 'ok' },
  vision_model: { status: 'ok' },
  embedder: { status: 'ok' },
  hindsight: { status: 'ok' },
};

export const isSettingsRead = ({ method, path }: Request) =>
  method === 'GET' && path === '/settings';
export const isSave = ({ method, path }: Request) => method === 'PUT' && path === '/settings';
export const isCheck = ({ method, path }: Request) =>
  method === 'POST' && path === '/settings/check';

export const isModelList = ({ method, path }: Request) =>
  method === 'POST' && path === '/settings/models';

export const LISTED_MODELS = { status: 'ok', models: ['listed-large', 'listed-small'] };

/**
 * A server holding `state`, which answers a save with `saved`, a check with `check` and a
 * list of models with `models`.
 */
export const settingsServer = ({
  state = STATE,
  saved,
  check = OK_CHECK,
  models = LISTED_MODELS,
}: {
  readonly state?: unknown;
  readonly saved?: Answer;
  readonly check?: unknown;
  readonly models?: unknown;
} = {}): Answer => {
  const answerSave = saved ?? (() => json(state));
  return (request) => {
    if (isSettingsRead(request)) return json(state);
    if (isSave(request)) return answerSave(request);
    if (isCheck(request)) return json(check);
    if (isModelList(request)) return json(models);
    return undefined;
  };
};

export const region = async (name: string) => screen.findByRole('region', { name });

/** A kept key has no input at all: nothing could hold its value. */
export const expectNoKeyInput = (): void => {
  screen.getAllByRole('group', { name: 'API key' }).forEach((group) => {
    expect(group.querySelector('input')).toBeNull();
  });
};
