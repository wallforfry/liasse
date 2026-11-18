import { SETUP_BASE_PATH } from '@liasse/contract';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { authPath, errorBody, fakeServer, json, renderApp } from '../test/render.test-helper.tsx';

// What the auth server signs when it sends an authorization to the consent page.
const OAUTH_QUERY = 'client_id=cli_synthetic&scope=openid&sig=synthetic-signature';

const signedOut = () =>
  fakeServer((request) => (request.path === authPath('/get-session') ? json(null) : undefined));

/** `fetch` of `server`, except that the setup status and the session wait for `release`. */
const heldFetch = (server: ReturnType<typeof fakeServer>) => {
  let release: (answer: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path === SETUP_BASE_PATH) return (await promise).clone();
    if (path === authPath('/get-session')) {
      await promise;
      return server.fetch(input, init);
    }
    return server.fetch(input, init);
  };
  return {
    fetch,
    release: (answer: Response) => {
      release(answer);
    },
  };
};

describe('the setup gate', () => {
  // The login page shows its form while the session is still unknown: only the gate keeps it
  // from showing on a server that has no account yet.
  it('shows no page until the server says whether setup is needed', async () => {
    const { fetch, release } = heldFetch(signedOut());
    const { container } = renderApp('/login', fetch);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('Log in to Liasse')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up Liasse' })).not.toBeInTheDocument();

    release(json({ needs_setup: true }));
    expect(await screen.findByRole('heading', { name: 'Set up Liasse' })).toBeInTheDocument();
    expect(screen.queryByText('Log in to Liasse')).not.toBeInTheDocument();
  });

  it.each([
    ['refuses', () => Promise.resolve(errorBody(500, 'internal_error', 'Unexpected.'))],
    ['cannot be reached', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('shows the application when the setup status %s', async (_, answer) => {
    const server = signedOut();
    const fetch: typeof globalThis.fetch = async (input, init) =>
      new URL(input instanceof Request ? input.url : String(input)).pathname === SETUP_BASE_PATH
        ? answer()
        : server.fetch(input, init);
    renderApp('/login', fetch);

    expect(await screen.findByText('Log in to Liasse')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up Liasse' })).not.toBeInTheDocument();
  });

  it('keeps an OAuth authorization through the login once an account exists', async () => {
    const { router } = renderApp(`/consent?${OAUTH_QUERY}`, signedOut().fetch);

    expect(await screen.findByText('Log in to Liasse')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?${OAUTH_QUERY}`);
  });
});
