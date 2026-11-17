import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, jsonBody, renderApp } from '../../test/render.test-helper.tsx';

const SUMMARY = {
  id: 'doc_synthetic_list',
  status: 'indexed',
  state: 'current',
  type: 'energy_bill',
  title: 'Listed bill',
  summary: null,
  mime: 'application/pdf',
  original_name: 'listed.pdf',
  source: 'api',
  private: false,
  confidence: 0.9,
  error: null,
  core: {},
  ingested_at: '2026-11-01T09:00:00.000Z',
  updated_at: '2026-11-01T09:00:00.000Z',
};

const RESULT = {
  id: 'doc_synthetic_found',
  title: 'Found bill',
  type: 'energy_bill',
  core: {},
  snippets: [
    { text: 'Your electricity use', page_from: 2, page_to: 2, highlights: [{ start: 5, end: 16 }] },
  ],
  score: 0.03,
};

const library = () =>
  fakeServer((request) => {
    if (request.path.startsWith('/types')) return json({ types: [] });
    if (request.path.startsWith('/documents')) {
      return json({ documents: [SUMMARY], total: 120, has_more: true });
    }
    if (request.path === '/search') return json({ results: [RESULT] });
    return undefined;
  });

const searchBodies = (server: ReturnType<typeof library>) =>
  server.requests.filter(({ path }) => path === '/search').map(jsonBody);

describe('the document list', () => {
  it('becomes the search of the box, with its filters, ranked and without pages', async () => {
    const server = library();
    const { router } = renderApp('/documents?type=energy_bill&offset=50', server.fetch);
    await screen.findByRole('link', { name: 'Listed bill' });

    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search the documents' }), ' power ');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('link', { name: 'Found bill' })).toBeInTheDocument();
    expect(screen.getByText('electricity', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.getByText('1 result, most relevant first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?type=energy_bill&q=power');
    expect(searchBodies(server)).toEqual([
      { query: 'power', filters: { type: 'energy_bill' }, limit: 50, include_private: false },
    ]);
  });

  it('goes back to the list when the search is cleared', async () => {
    const server = library();
    const { router } = renderApp('/documents?q=power', server.fetch);
    await screen.findByRole('link', { name: 'Found bill' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear' }));

    expect(await screen.findByRole('link', { name: 'Listed bill' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search the documents' })).toHaveValue('');
    expect(router.state.location.search).toBe('');
  });

  it('searches the review queue within the documents to review', async () => {
    const server = library();
    renderApp('/review?q=power', server.fetch);
    await screen.findByRole('link', { name: 'Found bill' });
    await waitFor(() => {
      expect(searchBodies(server)).toEqual([
        { query: 'power', filters: { status: 'needs_review' }, limit: 50, include_private: false },
      ]);
    });
  });

  it('offers to keep only private documents in the list, not in a search', async () => {
    const user = userEvent.setup();
    const list = renderApp('/documents', library().fetch);
    await screen.findByRole('link', { name: 'Listed bill' });
    screen.getByRole('combobox', { name: 'Privacy' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: 'Private only' })).toBeInTheDocument();
    list.unmount();

    renderApp('/documents?q=power', library().fetch);
    await screen.findByRole('link', { name: 'Found bill' });
    screen.getByRole('combobox', { name: 'Privacy' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: 'Include private' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Private only' })).not.toBeInTheDocument();
  });

  it('keeps the results of a search on screen while a filter changes it', async () => {
    const user = userEvent.setup();
    const server = library();
    // The search with private documents never answers: what shows meanwhile stays.
    const fetch: typeof globalThis.fetch = (input, init) =>
      typeof init?.body === 'string' && init.body.includes('"include_private":true')
        ? new Promise<Response>(() => undefined)
        : server.fetch(input, init);
    const { router } = renderApp('/documents?q=power', fetch);
    await screen.findByRole('link', { name: 'Found bill' });
    screen.getByRole('combobox', { name: 'Privacy' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Include private' }));
    expect(router.state.location.search).toBe('?q=power&private=include');
    expect(screen.getByRole('link', { name: 'Found bill' })).toBeInTheDocument();
  });
});

describe('the search of the documents', () => {
  it('has no page or menu entry of its own', async () => {
    renderApp('/search?q=power', library().fetch);
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Documents' })).toBeInTheDocument();
  });
});
