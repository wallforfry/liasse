import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  type Answer,
  authPath,
  fakeServer,
  json,
  jsonBody,
  renderApp,
} from '../../test/render.test-helper.tsx';

const API_KEY = {
  id: 'key_synthetic',
  name: 'Synthetic agent',
  start: 'lia_ab',
  prefix: 'lia_',
  createdAt: '2026-11-01T10:00:00.000Z',
  expiresAt: null,
  lastRequest: '2026-11-14T08:30:00.000Z',
  enabled: true,
};
const FULL_KEY = 'lia_absynthetickeyshownonce';

const apiKeys: Answer = (request) => {
  if (request.path.startsWith(authPath('/api-key/list'))) {
    return json({ apiKeys: [API_KEY], total: 1 });
  }
  if (request.path === authPath('/api-key/create')) {
    return json({ ...API_KEY, id: 'key_created', name: 'Second agent', key: FULL_KEY });
  }
  if (request.path === authPath('/api-key/delete')) return json({ success: true });
  return undefined;
};

const listings = (requests: readonly { readonly path: string }[]): number =>
  requests.filter(({ path }) => path.startsWith(authPath('/api-key/list'))).length;

describe('the API keys page', () => {
  it('lists the keys with their start and dates', async () => {
    const server = fakeServer(apiKeys);
    renderApp('/account/api-keys', server.fetch);

    const row = (await screen.findByText('Synthetic agent')).closest('tr');
    if (row === null) throw new Error('Expected the key in a table row');
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Synthetic agent',
      'lia_ab...',
      '2026-11-01 10:00 UTC',
      'Never',
      '2026-11-14 08:30 UTC',
      'Delete',
    ]);
  });

  it('creates a key and shows it once', async () => {
    const server = fakeServer(apiKeys);
    renderApp('/account/api-keys', server.fetch);
    const user = userEvent.setup();
    await screen.findByText('Synthetic agent');
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    await user.type(screen.getByLabelText('Name'), ' Second agent ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByLabelText('API key')).toHaveValue(FULL_KEY);
    expect(screen.getByText(/it will not be shown again/)).toBeInTheDocument();
    const create = server.requests.find(({ path }) => path === authPath('/api-key/create'));
    expect(create?.method).toBe('POST');
    expect(jsonBody(create)).toEqual({ name: 'Second agent' });
    await user.click(screen.getByRole('button', { name: 'Copy the API key' }));
    expect(await navigator.clipboard.readText()).toBe(FULL_KEY);
    await waitFor(() => {
      expect(listings(server.requests)).toBe(2);
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    expect(screen.queryByDisplayValue(FULL_KEY)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('deletes a key only after the confirmation', async () => {
    const server = fakeServer(apiKeys);
    renderApp('/account/api-keys', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete Synthetic agent' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(server.requests.some(({ path }) => path === authPath('/api-key/delete'))).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(listings(server.requests)).toBe(2);
    });
    const deletion = server.requests.find(({ path }) => path === authPath('/api-key/delete'));
    expect(deletion?.method).toBe('POST');
    expect(jsonBody(deletion)).toEqual({ keyId: 'key_synthetic' });
  });
});
