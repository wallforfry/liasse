import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  type Answer,
  authError,
  authPath,
  fakeServer,
  json,
  jsonBody,
  renderApp,
} from '../../test/render.test-helper.tsx';

const CONNECTION = {
  id: 'ocl_synthetic',
  client_id: 'https://client.example.net/oauth/metadata.json',
  name: 'Synthetic MCP client',
  client_uri: 'https://client.example.net',
  redirect_uris: ['https://client.example.net/callback'],
  created_at: '2026-11-01T10:00:00.000Z',
  granted_scopes: ['offline_access', 'openid'],
  active_tokens: 2,
  last_token_issued_at: '2026-11-14T08:30:00.000Z',
};

const LIST = authPath('/mcp-connections/list');
const REVOKE = authPath('/mcp-connections/revoke');

const connections: Answer = (request) => {
  if (request.path === LIST) return json({ connections: [CONNECTION] });
  if (request.path === REVOKE) return json({ revoked: true });
  return undefined;
};

const listings = (requests: readonly { readonly path: string }[]): number =>
  requests.filter(({ path }) => path === LIST).length;

describe('the MCP connections page', () => {
  it('lists each connection with its client, scopes, tokens and dates', async () => {
    renderApp('/account/mcp-connections', fakeServer(connections).fetch);

    const row = (await screen.findByText('Synthetic MCP client')).closest('tr');
    if (row === null) throw new Error('Expected the connection in a table row');
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Synthetic MCP client',
      'https://client.example.net/oauth/metadata.json',
      'https://client.example.net/callback',
      'offline_access openid',
      '2',
      '2026-11-01 10:00 UTC',
      '2026-11-14 08:30 UTC',
      'Revoke',
    ]);
  });

  it('names a client without a name by its client id, and its missing token as never', async () => {
    const unnamed: Answer = (request) =>
      request.path === LIST
        ? json({ connections: [{ ...CONNECTION, name: null, last_token_issued_at: null }] })
        : undefined;
    renderApp('/account/mcp-connections', fakeServer(unnamed).fetch);
    expect(
      await screen.findByRole('button', { name: `Revoke ${CONNECTION.client_id}` }),
    ).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('says when no client is connected', async () => {
    const none: Answer = (request) =>
      request.path === LIST ? json({ connections: [] }) : undefined;
    renderApp('/account/mcp-connections', fakeServer(none).fetch);
    expect(await screen.findByText('No MCP client is connected.')).toBeInTheDocument();
  });

  it('shows a refusal of the listing', async () => {
    const refused: Answer = (request) =>
      request.path === LIST ? authError(500, 'FAILED', 'The listing failed.') : undefined;
    renderApp('/account/mcp-connections', fakeServer(refused).fetch);
    expect(await screen.findByText('MCP connections not loaded')).toBeInTheDocument();
  });

  it('revokes a connection only after the confirmation, then lists again', async () => {
    const server = fakeServer(connections);
    renderApp('/account/mcp-connections', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke Synthetic MCP client' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(server.requests.some(({ path }) => path === REVOKE)).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(listings(server.requests)).toBe(2);
    });
    const revocation = server.requests.find(({ path }) => path === REVOKE);
    expect(revocation?.method).toBe('POST');
    expect(jsonBody(revocation)).toEqual({ id: 'ocl_synthetic' });
  });
});
