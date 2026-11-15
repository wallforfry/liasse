import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Answer,
  authPath,
  fakeServer,
  json,
  jsonBody,
  LIVE_SESSION,
  renderApp,
} from '../test/render.test-helper.tsx';

// What the auth server signs when it sends an authorization to the consent page.
const OAUTH_QUERY =
  'client_id=cli_synthetic&scope=openid+documents%3Aread&sig=synthetic-signature&ba_param=ba_param&ba_param=client_id&ba_param=scope';
const CALLBACK = 'https://client.example.test/callback?code=synthetic-code';
// Markup in a name the client registered is text, never HTML.
const CLIENT_NAME = '<b>Synthetic agent</b>';

const oauthServer: Answer = (request) => {
  if (request.path === authPath('/oauth2/public-client?client_id=cli_synthetic')) {
    return json({ client_id: 'cli_synthetic', client_name: CLIENT_NAME });
  }
  if (request.path === authPath('/oauth2/consent')) return json({ redirect: true, url: CALLBACK });
  return undefined;
};

const decide = async (decision: 'Allow' | 'Deny') => {
  const server = fakeServer(oauthServer);
  const { navigateAway } = renderApp(`/consent?${OAUTH_QUERY}`, server.fetch);
  await userEvent.setup().click(await screen.findByRole('button', { name: decision }));
  await waitFor(() => {
    expect(navigateAway).toHaveBeenCalledWith(CALLBACK);
  });
  const consent = server.requests.find(({ path }) => path === authPath('/oauth2/consent'));
  expect(consent?.method).toBe('POST');
  return jsonBody(consent);
};

describe('the consent page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', `/ui/consent?${OAUTH_QUERY}`);
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('names the client and the permissions it asks for, as text', async () => {
    const server = fakeServer(oauthServer);
    renderApp(`/consent?${OAUTH_QUERY}`, server.fetch);

    expect(await screen.findByText(CLIENT_NAME)).toBeInTheDocument();
    const scopes = screen.getByRole('list', { name: 'Requested permissions' });
    expect(
      within(scopes)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['openid', 'documents:read']);
  });

  it('allows the client and follows the redirection of the server', async () => {
    expect(await decide('Allow')).toEqual({ accept: true, oauth_query: OAUTH_QUERY });
  });

  it('denies the client and follows the redirection of the server', async () => {
    expect(await decide('Deny')).toEqual({ accept: false, oauth_query: OAUTH_QUERY });
  });

  it('sends a person without a session to the login page with the query of the authorization', async () => {
    let live = false;
    const server = fakeServer(oauthServer, (request) => {
      if (request.path === authPath('/sign-in/email')) {
        live = true;
        return json({ redirect: false, token: 'synthetic-token', user: LIVE_SESSION.user });
      }
      return request.path === authPath('/get-session') && !live ? json(null) : undefined;
    });
    const { router } = renderApp(`/consent?${OAUTH_QUERY}`, server.fetch);

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?${OAUTH_QUERY}`);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), 'synthetic-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(CLIENT_NAME)).toBeInTheDocument();
  });
});
