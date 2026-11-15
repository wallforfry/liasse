import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authPath, errorBody, fakeServer, json, renderApp } from '../test/render.test-helper.tsx';

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

const emptyLibrary = (request: { readonly path: string }) => {
  if (request.path.startsWith('/types')) return json({ types: [] });
  if (request.path.startsWith('/documents')) {
    return json({ documents: [], total: 0, has_more: false });
  }
  return undefined;
};

describe('the API client of the web UI', () => {
  it('sends the session cookie and no other credential', async () => {
    const server = fakeServer((request) => {
      if (request.path.startsWith('/documents/doc_01SYNTHETIC') && request.method === 'GET') {
        return json(DOCUMENT);
      }
      if (request.method === 'DELETE' && request.path.startsWith('/documents/')) {
        return new Response(null, { status: 204 });
      }
      return emptyLibrary(request);
    });
    renderApp('/documents/doc_01SYNTHETIC', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await screen.findByText('Most recent first.');

    const read = server.requests.find(({ path }) => path.startsWith('/documents/doc_01'));
    expect(read?.headers.get('Authorization')).toBeNull();
    expect(read?.credentials).toBe('same-origin');
    const deletion = server.requests.find(({ method }) => method === 'DELETE');
    expect(deletion?.path).toBe('/documents/doc_01SYNTHETIC');
    expect(deletion?.headers.get('Authorization')).toBeNull();
    expect(deletion?.credentials).toBe('same-origin');
  });

  it('sends the person to the login page when the REST API answers 401', async () => {
    const server = fakeServer((request) =>
      request.path.startsWith('/documents') || request.path.startsWith('/types')
        ? errorBody(401, 'unauthorized', 'A valid session or API key is required.')
        : undefined,
    );
    renderApp('/documents', server.fetch);
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('logs out on the auth server and shows the login page', async () => {
    let live = true;
    const server = fakeServer((request) => {
      if (request.path === authPath('/sign-out')) {
        live = false;
        return json({ success: true });
      }
      if (request.path === authPath('/get-session') && !live) return json(null);
      return emptyLibrary(request);
    });
    renderApp('/documents', server.fetch);
    const user = userEvent.setup();
    await screen.findByText('Most recent first.');
    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    const signOut = server.requests.find(({ path }) => path === authPath('/sign-out'));
    expect(signOut?.method).toBe('POST');
    expect(signOut?.credentials).toBe('include');
  });
});
