import type { ApiErrorCode } from '@liasse/contract';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  errorBody,
  fakeServer,
  json,
  jsonBody,
  renderApp,
} from '../../test/render.test-helper.tsx';

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

const ENTITY = {
  id: 'ent_synthetic_volta',
  kind: 'org',
  canonical_name: 'Volta Énergie',
  aliases: [],
  identifiers: [],
  document_count: 12,
};

// What `GET /entities/:id` answers: the one entity it knows, and 404 for any other id.
const knownEntity = (path: string): Response =>
  path === `/entities/${ENTITY.id}`
    ? json(ENTITY)
    : errorBody(404, 'entity_not_found', 'No entity has this id.');

const library = (lookup: (path: string) => Response = knownEntity) =>
  fakeServer((request) => {
    if (request.path.startsWith('/types')) return json({ types: [] });
    if (request.path.startsWith('/entities/')) return lookup(request.path);
    if (request.path.startsWith('/entities')) return json({ entities: [ENTITY], total: 1 });
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

  it('filters the list and its search by an entity searched by name', async () => {
    const user = userEvent.setup();
    const server = library();
    const { router } = renderApp('/documents?offset=50', server.fetch);
    await screen.findByRole('link', { name: 'Listed bill' });

    await user.click(screen.getByRole('combobox', { name: 'Entity' }));
    await user.type(screen.getByPlaceholderText('Search the entities...'), 'volta');
    await user.click(await screen.findByRole('option', { name: /Volta Énergie/ }));

    expect(router.state.location.search).toBe(
      '?entity=ent_synthetic_volta&entity_name=Volta+%C3%89nergie',
    );
    expect(screen.getByRole('combobox', { name: 'Entity' })).toHaveTextContent('Volta Énergie');
    await waitFor(() => {
      expect(server.requests.map(({ path }) => path)).toContain(
        '/documents?entity=ent_synthetic_volta&private=exclude&offset=0&limit=50',
      );
    });
    expect(server.requests.map(({ path }) => path)).toContain('/entities?query=volta&limit=20');

    await user.type(screen.getByRole('searchbox', { name: 'Search the documents' }), 'power');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('link', { name: 'Found bill' });
    expect(searchBodies(server)).toEqual([
      {
        query: 'power',
        filters: { entity: 'ent_synthetic_volta' },
        limit: 50,
        include_private: false,
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Clear the entity' }));
    expect(router.state.location.search).toBe('?q=power');
  });

  it('says when the entity of the address is gone, and clears it on request', async () => {
    const user = userEvent.setup();
    const server = library();
    const { router } = renderApp(
      '/documents?type=energy_bill&entity=ent_synthetic_merged&entity_name=Volta+SA',
      server.fetch,
    );

    expect(await screen.findByText('Unknown entity')).toBeInTheDocument();
    expect(screen.getByText(/the id this address gives for Volta SA/)).toBeInTheDocument();
    expect(screen.queryByText('No document matches.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Listed bill' })).not.toBeInTheDocument();
    const paths = server.requests.map(({ path }) => path);
    expect(paths).toContain('/entities/ent_synthetic_merged');
    expect(paths.filter((path) => path.startsWith('/documents'))).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Clear the entity filter' }));
    expect(router.state.location.search).toBe('?type=energy_bill');
    expect(await screen.findByRole('link', { name: 'Listed bill' })).toBeInTheDocument();
    expect(screen.queryByText('Unknown entity')).not.toBeInTheDocument();
  });

  it.each<readonly [number, ApiErrorCode]>([
    [403, 'origin_refused'],
    [404, 'document_not_found'],
    [500, 'internal_error'],
  ])('keeps the list when the lookup of the entity fails with %i %s', async (status, code) => {
    const server = library(() => errorBody(status, code, 'The lookup failed.'));
    renderApp('/documents?entity=ent_synthetic_volta&entity_name=Volta', server.fetch);

    expect(await screen.findByRole('link', { name: 'Listed bill' })).toBeInTheDocument();
    expect(server.requests.map(({ path }) => path)).toContain('/entities/ent_synthetic_volta');
    expect(screen.queryByText('Unknown entity')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Clear the entity filter' }),
    ).not.toBeInTheDocument();
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

  it('keeps the results of a search on screen, dimmed, while a filter changes it', async () => {
    const user = userEvent.setup();
    const server = library();
    // The search with private documents answers only once released: what shows meanwhile stays.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (typeof init?.body === 'string' && init.body.includes('"include_private":true')) {
        await held;
      }
      return server.fetch(input, init);
    };
    const { router } = renderApp('/documents?q=power', fetch);
    const resultsOf = (link: HTMLElement) => link.closest('[aria-busy]');
    expect(resultsOf(await screen.findByRole('link', { name: 'Found bill' }))).toHaveAttribute(
      'aria-busy',
      'false',
    );
    screen.getByRole('combobox', { name: 'Privacy' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Include private' }));
    expect(router.state.location.search).toBe('?q=power&private=include');
    const stale = resultsOf(screen.getByRole('link', { name: 'Found bill' }));
    expect(stale).toHaveAttribute('aria-busy', 'true');
    expect(stale).toHaveClass('opacity-50');

    release();
    await waitFor(() => {
      expect(stale).toHaveAttribute('aria-busy', 'false');
    });
    expect(stale).not.toHaveClass('opacity-50');
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
