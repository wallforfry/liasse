import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, jsonBody, renderApp } from '../../test/render.test-helper.tsx';
import { isModelList, region, settingsServer, STATE } from './settings.test-helper.ts';

const REMOTE_EMBEDDER = {
  ...STATE,
  settings: {
    ...STATE.settings,
    embedding: {
      provider: 'ollama',
      model: 'synthetic-embedder',
      timeout_ms: 60_000,
      api_key_state: 'unset',
    },
  },
};

describe('the model fields of the settings', () => {
  it('lists the models of the provider with the endpoint of the form, and picks one', async () => {
    const server = fakeServer(settingsServer());
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    await user.click(llm.getByRole('button', { name: 'Browse the models for Text model' }));
    await user.click(await screen.findByRole('option', { name: 'listed-small' }));

    expect(llm.getByLabelText('Text model')).toHaveValue('listed-small');
    expect(llm.getByLabelText('Vision model')).toHaveValue('synthetic-vision');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(jsonBody(server.requests.find(isModelList))).toEqual({
      section: 'llm',
      provider: 'openai-compatible',
      base_url: 'http://models.example.test/v1',
      api_key: { action: 'keep' },
    });
  });

  it('keeps the field typed by hand', async () => {
    renderApp('/account/settings', fakeServer(settingsServer()).fetch);
    const user = userEvent.setup();

    const field = within(await region('Language models')).getByLabelText('Vision model');
    await user.clear(field);
    await user.type(field, 'typed-model');
    expect(field).toHaveValue('typed-model');
  });

  it('says why the provider listed nothing', async () => {
    const models = {
      status: 'failed',
      code: 'unauthorized',
      message: 'The provider openai-compatible refused to list its models with HTTP 401.',
    };
    renderApp('/account/settings', fakeServer(settingsServer({ models })).fetch);
    const user = userEvent.setup();

    const llm = within(await region('Language models'));
    await user.click(llm.getByRole('button', { name: 'Browse the models for Vision model' }));

    expect(await screen.findByText(models.message)).toBeInTheDocument();
  });

  it('lists the models of a remote embedder, and none for the local one', async () => {
    const server = fakeServer(settingsServer({ state: REMOTE_EMBEDDER }));
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const embedder = within(await region('Embedder'));
    await user.click(embedder.getByRole('button', { name: 'Browse the models for Model' }));
    await user.click(await screen.findByRole('option', { name: 'listed-large' }));

    expect(embedder.getByLabelText('Model')).toHaveValue('listed-large');
    expect(jsonBody(server.requests.find(isModelList))).toMatchObject({
      section: 'embedding',
      provider: 'ollama',
    });
  });

  it('offers no list for the local embedder', async () => {
    renderApp('/account/settings', fakeServer(settingsServer()).fetch);

    const embedder = within(await region('Embedder'));
    expect(embedder.getByLabelText('Model')).toBeInTheDocument();
    expect(embedder.queryByRole('button', { name: /Browse the models/ })).not.toBeInTheDocument();
  });
});
