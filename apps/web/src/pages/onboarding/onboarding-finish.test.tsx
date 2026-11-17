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
import { OK_CHECK } from '../settings/settings.test-helper.ts';
import {
  EMAIL,
  fillModels,
  finish,
  isSetup,
  isSetupCheck,
  isSignIn,
  LLM_KEY,
  NAME,
  next,
  onboardingServer,
  passAccount,
  passToken,
  PASSWORD,
  reachSummary,
  step,
  TOKEN,
} from './onboarding.test-helper.ts';

const wrongToken = () =>
  errorBody(
    403,
    'invalid_setup_token',
    'The setup token is not the one this server printed at startup.',
  );

describe('the checks of the onboarding', () => {
  it('tries the language models with the token, and shows what each one answered', async () => {
    const server = fakeServer(
      onboardingServer({
        check: () =>
          json({
            ...OK_CHECK,
            vision_model: {
              status: 'failed',
              code: 'model_refused',
              message: 'The model refused the image.',
            },
          }),
      }),
    );
    renderApp('/', server.fetch);
    const user = userEvent.setup();
    await passToken(user, `  ${TOKEN}\n`);
    await passAccount(user);
    await fillModels(user);

    await user.click(screen.getByRole('button', { name: 'Check the language models' }));

    const results = await screen.findByRole('list', { name: 'Check of the language models' });
    expect(results).toHaveTextContent('Text modelAnswered');
    expect(results).toHaveTextContent('Vision modelFailedThe model refused the image.');
    expect(results.closest('[role="status"]')).not.toBeNull();
    const body = jsonBody(server.requests.find(isSetupCheck));
    expect(body).toMatchObject({
      token: TOKEN,
      settings: {
        llm: {
          provider: 'anthropic',
          text_model: 'synthetic-text',
          vision_model: 'synthetic-vision',
          api_key: { action: 'replace', value: LLM_KEY },
        },
        embedding: { provider: 'local' },
      },
    });
  });

  it('shows a refused dimension on the embedder step', async () => {
    const message = 'The embedder answered vectors of 384 values; the database holds 1024.';
    const server = fakeServer(
      onboardingServer({
        check: () =>
          json({
            ...OK_CHECK,
            embedder: { status: 'failed', code: 'dimension_mismatch', message },
          }),
      }),
    );
    renderApp('/', server.fetch);
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);
    await fillModels(user);
    await next(user);

    await user.click((await step('Embedder')).getByRole('button', { name: 'Check the embedder' }));
    const results = await screen.findByRole('list', { name: 'Check of the embedder' });
    expect(results).toHaveTextContent(`EmbedderFailed${message}`);
  });

  it('marks in place a field the check refused', async () => {
    const refused = () =>
      json(
        {
          error: {
            code: 'invalid_request',
            message: 'The request is not valid.',
            request_id: 'req_synthetic',
            issues: [{ path: 'settings.llm.text_model', message: 'This model is refused.' }],
          },
        },
        400,
      );
    renderApp('/', fakeServer(onboardingServer({ check: refused })).fetch);
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);
    await fillModels(user);

    await user.click(screen.getByRole('button', { name: 'Check the language models' }));

    const llm = await step('Language models');
    await waitFor(() => {
      expect(llm.getByLabelText('Text model')).toHaveAccessibleDescription(
        'This model is refused.',
      );
    });
  });

  it('sends a refused token back to its step, with the refusal', async () => {
    renderApp('/', fakeServer(onboardingServer({ check: wrongToken })).fetch);
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);
    await fillModels(user);

    await user.click(screen.getByRole('button', { name: 'Check the language models' }));

    const token = await step('Setup token');
    expect(token.getByRole('alert')).toHaveTextContent(
      'The setup token is not the one this server printed at startup.',
    );
  });
});

describe('the end of the onboarding', () => {
  it('sums up without a key, creates the account, signs in and opens the documents', async () => {
    const server = fakeServer(onboardingServer());
    renderApp('/types', server.fetch);
    const user = userEvent.setup();

    const summary = await reachSummary(user);
    expect(summary.getByText('Given')).toBeInTheDocument();
    expect(summary.queryByText(LLM_KEY)).not.toBeInTheDocument();
    expect(summary.getByText(EMAIL)).toBeInTheDocument();
    await finish(user);

    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(jsonBody(server.requests.find(isSetup))).toMatchObject({
      token: TOKEN,
      account: { name: NAME, email: EMAIL, password: PASSWORD },
      settings: { llm: { api_key: { action: 'replace', value: LLM_KEY } } },
    });
    expect(jsonBody(server.requests.find(isSignIn))).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it('sends a refused token back to its step', async () => {
    renderApp('/', fakeServer(onboardingServer({ setup: wrongToken })).fetch);
    const user = userEvent.setup();
    await reachSummary(user);
    await finish(user);

    expect((await step('Setup token')).getByRole('alert')).toHaveTextContent(
      'not the one this server printed',
    );
  });

  it('leaves for the login page when someone finished meanwhile', async () => {
    const server = fakeServer(
      onboardingServer({
        setup: () => errorBody(409, 'setup_done', 'An account exists already: sign in.'),
      }),
    );
    renderApp('/', server.fetch);
    const user = userEvent.setup();
    await reachSummary(user);
    await finish(user);

    expect(await screen.findByText('Log in to Liasse')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up Liasse' })).not.toBeInTheDocument();
    expect(server.requests.some(isSignIn)).toBe(false);
  });

  it('shows too many attempts in place', async () => {
    renderApp(
      '/',
      fakeServer(
        onboardingServer({
          setup: () => errorBody(429, 'too_many_attempts', 'Too many attempts at the setup token.'),
        }),
      ).fetch,
    );
    const user = userEvent.setup();
    await reachSummary(user);
    await finish(user);

    const summary = await step('Summary');
    expect(await summary.findByRole('alert')).toHaveTextContent(
      'Too many attempts at the setup token.',
    );
    expect(screen.getByRole('button', { name: 'Finish and sign in' })).toBeEnabled();
  });

  it('opens the step of a field the server refused, with its message', async () => {
    renderApp(
      '/',
      fakeServer(
        onboardingServer({
          setup: () =>
            json(
              {
                error: {
                  code: 'invalid_request',
                  message: 'The request is not valid.',
                  request_id: 'req_synthetic',
                  issues: [{ path: 'account.email', message: 'This address is refused.' }],
                },
              },
              400,
            ),
        }),
      ).fetch,
    );
    const user = userEvent.setup();
    await reachSummary(user);
    await finish(user);

    const account = await step('Your account');
    await waitFor(() => {
      expect(account.getByLabelText('Email')).toHaveAccessibleDescription(
        'This address is refused.',
      );
    });

    // Corrected, the account goes on to a summary that no longer shows the refusal.
    await user.clear(account.getByLabelText('Email'));
    await user.type(account.getByLabelText('Email'), 'other@example.test');
    await next(user);
    await next(user);
    await next(user);
    expect((await step('Summary')).queryByRole('alert')).not.toBeInTheDocument();
  });
});
