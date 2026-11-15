import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Answer,
  authError,
  authPath,
  fakeServer,
  json,
  jsonBody,
  LIVE_SESSION,
  renderApp,
} from '../test/render.test-helper.tsx';

const EMAIL = 'owner@example.test';
const PASSWORD = 'synthetic-password';

// What the auth server signs when it sends an authorization to the login page.
const OAUTH_QUERY =
  'client_id=cli_synthetic&scope=openid&sig=synthetic-signature&ba_param=ba_param&ba_param=client_id&ba_param=scope';

const library: Answer = (request) => {
  if (request.path.startsWith('/types')) return json({ types: [] });
  if (request.path.startsWith('/documents')) {
    return json({ documents: [], total: 0, has_more: false });
  }
  return undefined;
};

/** No session until the sign-in, which answers `signIn`. */
const signedOut = (signIn: () => Response): Answer => {
  let live = false;
  return (request) => {
    if (request.path === authPath('/sign-in/email')) {
      const answer = signIn();
      live = answer.ok;
      return answer;
    }
    if (request.path === authPath('/get-session') && !live) return json(null);
    return undefined;
  };
};

const signedIn = () => json({ redirect: false, token: 'synthetic-token', user: LIVE_SESSION.user });

const logIn = async () => {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), EMAIL);
  await user.type(screen.getByLabelText('Password'), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
};

describe('the login page', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('opens a session with the email and the password, then shows the page asked for', async () => {
    const server = fakeServer(signedOut(signedIn), library);
    renderApp('/review', server.fetch);
    await logIn();

    expect(await screen.findByText('Review queue')).toBeInTheDocument();
    const signIn = server.requests.find(({ path }) => path === authPath('/sign-in/email'));
    expect(signIn?.method).toBe('POST');
    expect(signIn?.credentials).toBe('include');
    expect(jsonBody(signIn)).toEqual({ email: EMAIL, password: PASSWORD });
    await waitFor(() => {
      expect(server.requests.some(({ path }) => path.includes('status=needs_review'))).toBe(true);
    });
  });

  it('shows the refusal of a wrong password and stays', async () => {
    const server = fakeServer(
      signedOut(() => authError(401, 'INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password')),
      library,
    );
    renderApp('/documents', server.fetch);
    await logIn();

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    expect(server.requests.some(({ path }) => path.startsWith('/documents'))).toBe(false);
  });

  it('shows the refusal of too many attempts', async () => {
    const server = fakeServer(
      signedOut(() => json({ message: 'Too many requests. Please try again later.' }, 429)),
    );
    renderApp('/documents', server.fetch);
    await logIn();

    expect(
      await screen.findByText('Too many requests. Please try again later.'),
    ).toBeInTheDocument();
  });

  it('continues an OAuth authorization by leaving for the URL the server answers', async () => {
    window.history.replaceState(null, '', `/ui/login?${OAUTH_QUERY}`);
    const callback = 'https://client.example.test/callback?code=synthetic-code';
    const server = fakeServer(signedOut(() => json({ redirect: true, url: callback })));
    const { navigateAway } = renderApp(`/login?${OAUTH_QUERY}`, server.fetch);
    await logIn();

    await waitFor(() => {
      expect(navigateAway).toHaveBeenCalledWith(callback);
    });
    const signIn = server.requests.find(({ path }) => path === authPath('/sign-in/email'));
    expect(jsonBody(signIn)).toMatchObject({ email: EMAIL, oauth_query: OAUTH_QUERY });
    expect(screen.getByRole('button', { name: 'Logging in...' })).toBeDisabled();
  });

  it('refuses a redirection that would run script in the page', async () => {
    const server = fakeServer(
      signedOut(() => json({ redirect: true, url: 'javascript:alert(1)' })),
    );
    const { navigateAway } = renderApp('/login', server.fetch);
    await logIn();

    expect(await screen.findByText(/answered in an unexpected way/)).toBeInTheDocument();
    expect(navigateAway).not.toHaveBeenCalled();
  });
});
