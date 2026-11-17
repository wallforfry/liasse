import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, jsonBody, renderApp } from '../../test/render.test-helper.tsx';
import {
  STATE,
  OK_CHECK,
  isSave,
  isCheck,
  settingsServer,
  region,
  expectNoKeyInput,
} from './settings.test-helper.ts';

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
    expectNoKeyInput();
    expect(screen.getAllByRole('group', { name: 'API key' })).toHaveLength(2);
    // The local embedder has no key to show.
    const embedder = within(await region('Embedder'));
    expect(embedder.queryByText('API key')).not.toBeInTheDocument();
  });

  it('masks the key being typed', async () => {
    renderApp('/account/settings', fakeServer(settingsServer()).fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    await user.click(llm.getByRole('button', { name: 'Replace the language model API key' }));

    const input = llm.getByLabelText('language model API key');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    // The visible label is the label of the input, not only of its group.
    const label = llm.getByText('API key');
    expect(label instanceof HTMLLabelElement ? label.control : null).toBe(input);
    expect(input).toHaveValue('');
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
    // Announced: the results land in a live region that was there before them.
    expect(within(llm.getByRole('status')).getByRole('list')).toBeInTheDocument();
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

  it('checks a section whatever another section holds', async () => {
    const server = fakeServer(settingsServer());
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const pipeline = within(await region('Pipeline'));
    await user.clear(pipeline.getByLabelText('Confidence threshold'));
    const llm = within(await region('Language models'));
    await user.click(llm.getByRole('button', { name: 'Check the language models' }));

    await waitFor(() => {
      expect(server.requests.some(isCheck)).toBe(true);
    });
    // The section still invalid is sent as it is stored, and not marked by a check.
    expect(jsonBody(server.requests.find(isCheck))).toMatchObject({
      settings: { pipeline: { confidence_threshold: 0.7 } },
    });
    expect(pipeline.getByLabelText('Confidence threshold')).toBeValid();

    await user.clear(llm.getByLabelText('Text model'));
    await user.click(llm.getByRole('button', { name: 'Check the language models' }));
    expect(llm.getByLabelText('Text model')).toBeInvalid();
    expect(server.requests.filter(isCheck)).toHaveLength(1);
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
