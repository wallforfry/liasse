import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, json, renderApp } from '../test/render.test-helper.tsx';

const emptyLibrary = () =>
  fakeServer((request) => {
    if (request.path.startsWith('/types')) return json({ types: [] });
    if (request.path.startsWith('/documents')) {
      return json({ documents: [], total: 0, has_more: false });
    }
    if (request.path.startsWith('/search')) return json({ results: [] });
    return undefined;
  });

const runInPalette = async (query: string) => {
  const user = userEvent.setup();
  await screen.findByText('Most recent first.');
  await user.keyboard('{Control>}k{/Control}');
  await user.type(await screen.findByPlaceholderText('Go to a page or search...'), query);
  await user.keyboard('{Enter}');
};

describe('the command palette', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('switches the theme it names rather than searching for its name', async () => {
    const server = emptyLibrary();
    renderApp('/documents', server.fetch);
    await runInPalette('dark');
    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
    });
    expect(localStorage.getItem('liasse-theme')).toBe('dark');
    expect(server.requests.some(({ path }) => path.startsWith('/search'))).toBe(false);
  });

  it('searches the documents for words that name no page', async () => {
    const server = emptyLibrary();
    renderApp('/documents', server.fetch);
    await runInPalette('electricity');
    expect(await screen.findByRole('searchbox', { name: 'Search the documents' })).toHaveValue(
      'electricity',
    );
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    await waitFor(() => {
      expect(server.requests.some(({ path }) => path === '/search')).toBe(true);
    });
  });
});
