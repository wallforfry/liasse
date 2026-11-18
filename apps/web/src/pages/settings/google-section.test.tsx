import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, jsonBody, renderApp } from '../../test/render.test-helper.tsx';
import { isSave, region, settingsServer, STATE } from './settings.test-helper.ts';

const withGoogle = {
  ...STATE,
  settings: {
    ...STATE.settings,
    google: { client_id: 'synthetic-client.apps.example.test', client_secret_state: 'set' },
  },
};

describe('the Google section of the settings', () => {
  it('says which redirect URI to register and that the app must be in production', async () => {
    renderApp('/account/settings', fakeServer(settingsServer()).fetch);

    const google = within(await region('Google'));
    expect(
      google.getByText(`${window.location.origin}/sources/google/callback`),
    ).toBeInTheDocument();
    expect(google.getByText(/move the app to In production/u)).toBeInTheDocument();
    expect(google.getByLabelText('Client id')).toHaveValue('');
    expect(
      within(google.getByRole('group', { name: 'Client secret' })).getByText('Not set'),
    ).toBeInTheDocument();
  });

  it('shows the stored client, its secret never', async () => {
    renderApp('/account/settings', fakeServer(settingsServer({ state: withGoogle })).fetch);

    const google = within(await region('Google'));
    expect(google.getByLabelText('Client id')).toHaveValue('synthetic-client.apps.example.test');
    const secret = google.getByRole('group', { name: 'Client secret' });
    expect(within(secret).getByText('Set')).toBeInTheDocument();
    expect(secret.querySelector('input')).toBeNull();
  });

  it('saves the client id and its secret', async () => {
    const server = fakeServer(settingsServer());
    renderApp('/account/settings', server.fetch);
    const user = userEvent.setup();

    const google = within(await region('Google'));
    await user.click(google.getByLabelText('Client id'));
    await user.paste('synthetic-client.apps.example.test');
    await user.click(google.getByRole('button', { name: 'Set the Google client secret' }));
    await user.click(google.getByLabelText('Google client secret'));
    await user.paste('synthetic-client-secret');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    await waitFor(() => {
      expect(server.requests.some(isSave)).toBe(true);
    });
    expect(jsonBody(server.requests.find(isSave))).toMatchObject({
      settings: {
        google: {
          client_id: 'synthetic-client.apps.example.test',
          client_secret: { action: 'replace', value: 'synthetic-client-secret' },
        },
      },
    });
  });

  it('marks the secret the server asks for with the client id', async () => {
    const refusal = () =>
      json(
        {
          error: {
            code: 'invalid_request',
            message: 'The request is not valid.',
            request_id: 'req_synthetic',
            issues: [{ path: 'google.client_secret', message: 'required with client_id' }],
          },
        },
        400,
      );
    renderApp('/account/settings', fakeServer(settingsServer({ saved: refusal })).fetch);
    const user = userEvent.setup();

    const google = within(await region('Google'));
    await user.click(google.getByLabelText('Client id'));
    await user.paste('synthetic-client.apps.example.test');
    await user.click(screen.getByRole('button', { name: 'Save the settings' }));

    expect(await google.findByText('required with client_id')).toBeInTheDocument();
  });
});
