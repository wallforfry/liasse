import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, fakeServer, json, renderApp, TEST_CSRF } from '../test/render.test-helper.tsx';

const DOCUMENT = {
  id: 'doc_01SYNTHETIC',
  status: 'indexed',
  state: 'current',
  type: 'invoice',
  title: 'Synthetic invoice',
  summary: null,
  mime: 'application/pdf',
  original_name: 'invoice.pdf',
  source: 'api',
  private: false,
  confidence: 0.9,
  error: null,
  core: {},
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: 1,
  hint: null,
  fields: {},
  text: { content: '', offset: 0, total_length: 0, has_more: false },
};

describe('the API client of the web UI', () => {
  it('sends the session cookie, and the CSRF token on what changes something', async () => {
    const server = fakeServer((request) => {
      if (request.path.startsWith('/documents/doc_01SYNTHETIC') && request.method === 'GET') {
        return json(DOCUMENT);
      }
      if (request.method === 'DELETE' && request.path.startsWith('/documents/')) {
        return new Response(null, { status: 204 });
      }
      if (request.path.startsWith('/documents'))
        return json({ documents: [], total: 0, has_more: false });
      if (request.path.startsWith('/types')) return json({ types: [] });
      return undefined;
    });
    renderApp('/documents/doc_01SYNTHETIC', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await screen.findByText('Most recent first.');

    const read = server.requests.find(({ path }) => path.startsWith('/documents/doc_01'));
    expect(read?.headers.get('X-CSRF-Token')).toBeNull();
    expect(read?.headers.get('Authorization')).toBeNull();
    expect(read?.credentials).toBe('same-origin');
    const deletion = server.requests.find(({ method }) => method === 'DELETE');
    expect(deletion?.path).toBe('/documents/doc_01SYNTHETIC');
    expect(deletion?.headers.get('X-CSRF-Token')).toBe(TEST_CSRF);
    expect(deletion?.credentials).toBe('same-origin');
  });

  it('sends the person to the login page when the API answers 401', async () => {
    const server = fakeServer((request) =>
      request.path.startsWith('/documents') || request.path.startsWith('/types')
        ? errorBody(401, 'unauthorized', 'A valid Bearer token is required.')
        : undefined,
    );
    renderApp('/documents', server.fetch);
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows the login page without a session, and opens one with the password', async () => {
    let live = false;
    const server = fakeServer((request) => {
      if (request.path !== '/ui/session') {
        return request.path.startsWith('/types')
          ? json({ types: [] })
          : json({ documents: [], total: 0, has_more: false });
      }
      if (request.method === 'POST') {
        live = true;
        return json({ csrf_token: TEST_CSRF });
      }
      return live ? undefined : errorBody(401, 'no_session', 'Log in to open a session.');
    });
    renderApp('/review', server.fetch);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Password'), 'synthetic-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Review queue')).toBeInTheDocument();
    const login = server.requests.find(({ method }) => method === 'POST');
    expect(login?.headers.get('Content-Type')).toBe('application/json');
    await waitFor(() => {
      expect(server.requests.some(({ path }) => path.includes('status=needs_review'))).toBe(true);
    });
  });
});
