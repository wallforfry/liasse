import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  type Answer,
  errorBody,
  fakeServer,
  json,
  jsonBody,
  renderApp,
  type Request,
} from '../../test/render.test-helper.tsx';

const STATE = {
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
  },
  embedder_locked: false,
};

const OK_CHECK = {
  text_model: { status: 'ok' },
  vision_model: { status: 'ok' },
  embedder: { status: 'ok' },
  hindsight: { status: 'ok' },
};

const isSettingsRead = ({ method, path }: Request) => method === 'GET' && path === '/settings';
const isSave = ({ method, path }: Request) => method === 'PUT' && path === '/settings';
const isCheck = ({ method, path }: Request) => method === 'POST' && path === '/settings/check';

/** A server holding `state`, which answers a save with `saved` and a check with `check`. */
const settingsServer = ({
  state = STATE,
  saved,
  check = OK_CHECK,
}: {
  readonly state?: unknown;
  readonly saved?: Answer;
  readonly check?: unknown;
} = {}): Answer => {
  const answerSave = saved ?? (() => json(state));
  return (request) => {
    if (isSettingsRead(request)) return json(state);
    if (isSave(request)) return answerSave(request);
    if (isCheck(request)) return json(check);
    return undefined;
  };
};

const region = async (name: string) => screen.findByRole('region', { name });

describe('the settings page', () => {
  it('is reached from the account navigation', async () => {
    renderApp('/account/api-keys', fakeServer(settingsServer()).fetch);
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows the stored settings', async () => {
    renderApp('/account/settings', fakeServer(settingsServer()).fetch);

    const llm = within(await region('Language models'));
    expect(llm.getByRole('combobox', { name: 'Provider' })).toHaveTextContent('openai-compatible');
    expect(llm.getByLabelText('Text model')).toHaveValue('synthetic-text');
    expect(llm.getByLabelText('Vision model')).toHaveValue('synthetic-vision');
    expect(llm.getByLabelText('Base URL')).toHaveValue('http://models.example.test/v1');
    expect(llm.getByLabelText('Timeout (ms)')).toHaveValue(120_000);

    const pipeline = within(await region('Pipeline'));
    expect(pipeline.getByRole('combobox', { name: 'Auto-apply' })).toHaveTextContent('safe');
    expect(pipeline.getByRole('combobox', { name: 'Schema language' })).toHaveTextContent('fr');
    expect(pipeline.getByLabelText('Confidence threshold')).toHaveValue(0.7);
    expect(pipeline.getByLabelText('Entity arbitration similarity')).toHaveValue(0.8);
    expect(pipeline.getByLabelText('Max file size (bytes)')).toHaveValue(52_428_800);

    const hindsight = within(await region('Hindsight'));
    expect(hindsight.getByLabelText('URL')).toHaveValue('http://hindsight.example.test');
    expect(hindsight.getByLabelText('Bank')).toHaveValue('documents');
    expect(screen.getByText('Saved 2026-11-16 09:00 UTC.')).toBeInTheDocument();
  });

  it('says whether each key is set, and never shows one', async () => {
    renderApp('/account/settings', fakeServer(settingsServer()).fetch);

    const llm = within(await region('Language models'));
    expect(llm.getByText('Set')).toBeInTheDocument();
    expect(llm.getByRole('button', { name: 'Clear the language model API key' })).toBeEnabled();
    const hindsight = within(await region('Hindsight'));
    expect(hindsight.getByText('Not set')).toBeInTheDocument();
    expect(hindsight.queryByRole('button', { name: /^Clear/u })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    // The local embedder has no key to show.
    const embedder = within(await region('Embedder'));
    expect(embedder.queryByText('API key')).not.toBeInTheDocument();
  });

  it('saves the whole document at its version, with only the changed keys', async () => {
    const savedState = {
      ...STATE,
      version: 4,
      updated_at: '2026-11-17T10:30:00.000Z',
      settings: {
        ...STATE.settings,
        llm: { ...STATE.settings.llm, text_model: 'synthetic-text-2' },
        hindsight: { ...STATE.settings.hindsight, api_key_state: 'set' },
      },
    };
    const server = fakeServer(settingsServer({ saved: () => json(savedState) }));
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    await user.clear(llm.getByLabelText('Text model'));
    await user.click(llm.getByLabelText('Text model'));
    await user.paste('synthetic-text-2');
    await user.click(llm.getByRole('button', { name: 'Clear the language model API key' }));
    const hindsight = within(await region('Hindsight'));
    await user.click(hindsight.getByRole('button', { name: 'Replace the Hindsight API key' }));
    await user.click(hindsight.getByLabelText('Hindsight API key'));
    await user.paste('synthetic-hindsight-key');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    expect(await screen.findByText('Saved 2026-11-17 10:30 UTC.')).toBeInTheDocument();
    const body = jsonBody(server.requests.find(isSave));
    expect(body).toMatchObject({
      version: 3,
      settings: {
        llm: { text_model: 'synthetic-text-2', api_key: { action: 'clear' } },
        embedding: { provider: 'local', api_key: { action: 'keep' } },
        pipeline: { schema_language: 'fr', confidence_threshold: 0.7 },
        hindsight: {
          url: 'http://hindsight.example.test',
          api_key: { action: 'replace', value: 'synthetic-hindsight-key' },
        },
      },
    });
    // The saved version gives a new form: every key kept again, none shown.
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(within(await region('Hindsight')).getByText('Set')).toBeInTheDocument();
  });

  it('asks for a key that no longer opens to be replaced or cleared', async () => {
    const unreadable = {
      ...STATE,
      settings: {
        ...STATE.settings,
        llm: { ...STATE.settings.llm, api_key_state: 'unreadable' },
        embedding: { ...STATE.settings.embedding, api_key_state: 'unreadable' },
      },
    };
    const server = fakeServer(settingsServer({ state: unreadable }));
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    expect(llm.getByText('Unreadable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));
    expect(
      llm.getByText('This key no longer opens under the current AUTH_SECRET: replace or clear it.'),
    ).toBeInTheDocument();
    expect(server.requests.some(isSave)).toBe(false);

    await user.click(llm.getByRole('button', { name: 'Replace the language model API key' }));
    await user.click(llm.getByLabelText('language model API key'));
    await user.paste('synthetic-new-key');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    await waitFor(() => {
      expect(server.requests.some(isSave)).toBe(true);
    });
    // The local embedder reads no key: the one that no longer opens is dropped.
    expect(jsonBody(server.requests.find(isSave))).toMatchObject({
      settings: {
        llm: { api_key: { action: 'replace', value: 'synthetic-new-key' } },
        embedding: { provider: 'local', api_key: { action: 'clear' } },
      },
    });
  });

  it('marks what the schema refuses in place, and sends nothing', async () => {
    const server = fakeServer(settingsServer());
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    await user.clear(llm.getByLabelText('Base URL'));
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    expect(llm.getByLabelText('Base URL')).toBeInvalid();
    expect(llm.getByText('required when provider is openai-compatible')).toBeInTheDocument();
    expect(llm.getByLabelText('Text model')).toBeValid();
    expect(server.requests.some(isSave)).toBe(false);
  });

  it('marks what the server refuses in place', async () => {
    const refused: Answer = () =>
      json(
        {
          error: {
            code: 'invalid_request',
            message: 'The request is not valid.',
            request_id: 'req_synthetic',
            issues: [
              { path: 'hindsight.api_key', message: 'required by this server' },
              { path: 'settings.llm.text_model', message: 'refused by this server' },
            ],
          },
        },
        400,
      );
    renderApp('/account/settings', fakeServer(settingsServer({ saved: refused })).fetch);
    const user = userEvent.setup();

    await region('Hindsight');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    const hindsight = within(await region('Hindsight'));
    expect(await hindsight.findByText('required by this server')).toBeInTheDocument();
    const llm = within(await region('Language models'));
    expect(llm.getByText('refused by this server')).toBeInTheDocument();
    expect(llm.getByLabelText('Text model')).toBeInvalid();
    expect(screen.getByText('The request is not valid.')).toBeInTheDocument();
  });

  it('offers to reload settings saved elsewhere in the meantime', async () => {
    const newer = {
      ...STATE,
      version: 5,
      settings: { ...STATE.settings, llm: { ...STATE.settings.llm, text_model: 'newer-text' } },
    };
    const reads = { count: 0 };
    const server = fakeServer((request) => {
      if (isSettingsRead(request)) {
        reads.count += 1;
        return json(reads.count === 1 ? STATE : newer);
      }
      if (isSave(request)) {
        return errorBody(409, 'settings_conflict', 'The settings changed since they were read.');
      }
      return undefined;
    });
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    await user.click(llm.getByLabelText('Vision model'));
    await user.paste('-edited');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));
    await user.click(await screen.findByRole('button', { name: 'Reload the settings' }));

    const reloaded = within(await region('Language models'));
    await waitFor(() => {
      expect(reloaded.getByLabelText('Text model')).toHaveValue('newer-text');
    });
    expect(reloaded.getByLabelText('Vision model')).toHaveValue('synthetic-vision');
    expect(screen.queryByText('Settings changed elsewhere')).not.toBeInTheDocument();
  });

  it('locks the embedder once documents exist, and says why', async () => {
    const locked = { ...STATE, embedder_locked: true };
    renderApp('/account/settings', fakeServer(settingsServer({ state: locked })).fetch);

    const embedder = within(await region('Embedder'));
    expect(embedder.getByText('Provider and model are locked')).toBeInTheDocument();
    expect(embedder.getByRole('combobox', { name: 'Provider' })).toBeDisabled();
    expect(embedder.getByLabelText('Model')).toBeDisabled();
    expect(embedder.getByLabelText('Timeout (ms)')).toBeEnabled();
  });

  it('shows the refusal of a locked embedder', async () => {
    const refused: Answer = () =>
      errorBody(409, 'embedder_locked', 'The embedder cannot change once a document exists.');
    renderApp('/account/settings', fakeServer(settingsServer({ saved: refused })).fetch);
    const user = userEvent.setup();

    await region('Embedder');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    expect(
      await screen.findByText('The embedder cannot change once a document exists.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload the settings' })).not.toBeInTheDocument();
  });

  it('checks a section and shows what its parts answered', async () => {
    const check = {
      ...OK_CHECK,
      vision_model: {
        status: 'failed',
        code: 'model_unreachable',
        message: 'The vision model did not answer.',
      },
      hindsight: { status: 'skipped' },
    };
    const server = fakeServer(settingsServer({ check }));
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    await user.click(llm.getByRole('button', { name: 'Check the language models' }));

    const results = within(await llm.findByRole('list', { name: 'Check of the language models' }));
    expect(results.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Text modelAnswered',
      'Vision modelFailedThe vision model did not answer.',
    ]);
    expect(jsonBody(server.requests.find(isCheck))).toMatchObject({
      settings: { llm: { text_model: 'synthetic-text', api_key: { action: 'keep' } } },
    });
    const hindsight = within(await region('Hindsight'));
    expect(hindsight.queryByRole('list')).not.toBeInTheDocument();
    expect(server.requests.some(isSave)).toBe(false);
  });

  it('starts from the defaults of the schema when nothing was saved', async () => {
    const unsaved = { version: 0, updated_at: null, settings: null, embedder_locked: true };
    renderApp('/account/settings', fakeServer(settingsServer({ state: unsaved })).fetch);

    const llm = within(await region('Language models'));
    expect(llm.getByRole('combobox', { name: 'Provider' })).toHaveTextContent('anthropic');
    expect(llm.getByLabelText('Timeout (ms)')).toHaveValue(300_000);
    expect(llm.getByText('Not set')).toBeInTheDocument();
    const embedder = within(await region('Embedder'));
    expect(embedder.getByRole('combobox', { name: 'Provider' })).toHaveTextContent('local');
    // A first save names the embedder the documents were indexed with: nothing is locked.
    expect(embedder.getByRole('combobox', { name: 'Provider' })).toBeEnabled();
    expect(screen.getByText('Never saved.')).toBeInTheDocument();
  });
});
