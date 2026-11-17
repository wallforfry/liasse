import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  type Answer,
  errorBody,
  fakeServer,
  json,
  jsonBody,
  renderApp,
} from '../../test/render.test-helper.tsx';
import {
  STATE,
  isSettingsRead,
  isSave,
  settingsServer,
  region,
  expectNoKeyInput,
} from './settings.test-helper.ts';

describe('a save of the settings', () => {
  it('keeps the stored key when a replace or a clear is cancelled', async () => {
    const server = fakeServer(settingsServer());
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    await user.click(llm.getByRole('button', { name: 'Replace the language model API key' }));
    await user.click(llm.getByLabelText('language model API key'));
    await user.paste('synthetic-dropped-key');
    await user.click(
      llm.getByRole('button', { name: 'Cancel the change of the language model API key' }),
    );
    expect(llm.queryByLabelText('language model API key')).not.toBeInTheDocument();
    await user.click(llm.getByRole('button', { name: 'Clear the language model API key' }));
    await user.click(
      llm.getByRole('button', { name: 'Cancel the change of the language model API key' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    await waitFor(() => {
      expect(server.requests.some(isSave)).toBe(true);
    });
    expect(jsonBody(server.requests.find(isSave))).toMatchObject({
      settings: { llm: { api_key: { action: 'keep' } } },
    });
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
    await user.click(hindsight.getByRole('button', { name: 'Set the Hindsight API key' }));
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
    expectNoKeyInput();
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
    expect(
      screen
        .getAllByRole('status')
        .some(
          ({ textContent }) =>
            textContent === 'Some settings are not valid: see the marked fields.',
        ),
    ).toBe(true);
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

    // A check of another section that passes leaves the marks of the refused save.
    const embedder = within(await region('Embedder'));
    await user.click(embedder.getByRole('button', { name: 'Check the embedder' }));
    expect(
      await embedder.findByRole('list', { name: 'Check of the embedder' }),
    ).toBeInTheDocument();
    expect(hindsight.getByText('required by this server')).toBeInTheDocument();
    expect(llm.getByLabelText('Text model')).toBeInvalid();
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

  it('locks the embedder once a save finds it locked', async () => {
    const reads = { count: 0 };
    const server = fakeServer((request) => {
      if (isSettingsRead(request)) {
        reads.count += 1;
        return json({ ...STATE, embedder_locked: reads.count > 1 });
      }
      if (isSave(request)) {
        return errorBody(
          409,
          'embedder_locked',
          'The embedder cannot change once a document exists.',
        );
      }
      return undefined;
    });
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    // Radix Select reads pointer capture on its trigger, which jsdom does not implement.
    Object.defineProperties(Element.prototype, {
      hasPointerCapture: { configurable: true, value: () => false },
      releasePointerCapture: { configurable: true, value: () => undefined },
    });
    onTestFinished(() => {
      Reflect.deleteProperty(Element.prototype, 'hasPointerCapture');
      Reflect.deleteProperty(Element.prototype, 'releasePointerCapture');
    });
    const embedder = within(await region('Embedder'));
    await user.click(embedder.getByRole('combobox', { name: 'Provider' }));
    await user.click(await screen.findByRole('option', { name: 'openai' }));
    await user.click(embedder.getByLabelText('Model'));
    await user.paste('synthetic-embedding');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    expect(await embedder.findByText('Provider and model are locked')).toBeInTheDocument();
    const provider = embedder.getByRole('combobox', { name: 'Provider' });
    expect(provider).toBeDisabled();
    expect(provider).toHaveTextContent('local');
    expect(embedder.getByLabelText('Model')).toHaveValue('');
  });
});
