import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, renderApp } from '../../test/render.test-helper.tsx';
import {
  fillModels,
  next,
  onboardingServer,
  passAccount,
  passToken,
  step,
  TOKEN,
} from './onboarding.test-helper.ts';

const currentStep = () => screen.getByRole('listitem', { current: 'step' });

describe('the onboarding', () => {
  it.each(['/login', '/documents', '/account/settings'])(
    'shows instead of %s while no account exists',
    async (path) => {
      renderApp(path, fakeServer(onboardingServer()).fetch);

      expect(await screen.findByRole('heading', { name: 'Set up Liasse' })).toBeInTheDocument();
      expect(currentStep()).toHaveTextContent('Setup token');
      expect(screen.queryByText('Log in to Liasse')).not.toBeInTheDocument();
    },
  );

  it('is not shown once an account exists', async () => {
    renderApp(
      '/login',
      fakeServer((request) => (request.path === '/api/auth/get-session' ? json(null) : undefined))
        .fetch,
    );

    expect(await screen.findByText('Log in to Liasse')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up Liasse' })).not.toBeInTheDocument();
  });

  it('asks for the token printed in the logs, masked, and refuses an empty one', async () => {
    renderApp('/', fakeServer(onboardingServer()).fetch);
    const user = userEvent.setup();

    const token = await step('Setup token');
    expect(token.getByText(/docker compose logs liasse/u)).toBeInTheDocument();
    expect(token.getByLabelText('Setup token')).toHaveAttribute('type', 'password');
    await next(user);
    expect(token.getByText('Paste the token the server printed.')).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Setup token');

    await passToken(user, `  ${TOKEN}\n`);
    expect(currentStep()).toHaveTextContent('Account');
  });

  it('checks the account with the rules of the server, and the password typed twice', async () => {
    renderApp('/', fakeServer(onboardingServer()).fetch);
    const user = userEvent.setup();
    await passToken(user);

    const account = await step('Your account');
    expect(account.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await user.type(account.getByLabelText('Email'), 'not-an-email');
    await user.type(account.getByLabelText('Password'), 'short');
    await user.type(account.getByLabelText('Password again'), 'other');
    await next(user);

    expect(account.getByLabelText('Name')).toHaveAccessibleDescription(
      /expected string|Too small/u,
    );
    expect(account.getByLabelText('Email')).toHaveAccessibleDescription(
      'expected an email address',
    );
    expect(account.getByLabelText('Password')).toHaveAccessibleDescription(
      /expected at least 12 characters/u,
    );
    expect(account.getByLabelText('Password again')).toHaveAccessibleDescription(
      'The two passwords differ.',
    );
    expect(currentStep()).toHaveTextContent('Account');
  });

  it('goes back to the previous step with what was typed there', async () => {
    renderApp('/', fakeServer(onboardingServer()).fetch);
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);
    await step('Language models');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect((await step('Your account')).getByLabelText('Name')).toHaveValue('Owner');
  });

  it('asks for the models and the key the provider needs, masked', async () => {
    renderApp('/', fakeServer(onboardingServer()).fetch);
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);

    const llm = await step('Language models');
    await next(user);
    expect(llm.getByLabelText('Text model')).toHaveAccessibleDescription(/Too small|at least/u);
    expect(currentStep()).toHaveTextContent('Language models');

    // Valid models but no key: before the first account, nothing stored can stand in for it.
    await user.type(llm.getByLabelText('Text model'), 'synthetic-text');
    await user.type(llm.getByLabelText('Vision model'), 'synthetic-vision');
    await next(user);
    expect(llm.getByText('required when provider is anthropic')).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Language models');

    await user.clear(llm.getByLabelText('Text model'));
    await user.clear(llm.getByLabelText('Vision model'));
    await fillModels(user);
    expect(llm.getByLabelText('language model API key')).toHaveAttribute('type', 'password');
    await next(user);
    expect(currentStep()).toHaveTextContent('Embedder');
  });

  it('offers the local embedder by default', async () => {
    renderApp('/', fakeServer(onboardingServer()).fetch);
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);
    await fillModels(user);
    await next(user);

    const embedder = await step('Embedder');
    expect(embedder.getByRole('combobox', { name: 'Provider' })).toHaveTextContent('local');
    expect(embedder.getByRole('combobox', { name: 'Provider' })).toBeEnabled();
    expect(embedder.queryByText('API key')).not.toBeInTheDocument();
    await next(user);
    expect(currentStep()).toHaveTextContent('Summary');
  });
});
