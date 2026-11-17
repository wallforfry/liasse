import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, fakeServer, json, renderApp } from '../../test/render.test-helper.tsx';
import { OK_CHECK } from '../settings/settings.test-helper.ts';
import {
  fillModels,
  finish,
  isSetup,
  isSetupCheck,
  next,
  onboardingServer,
  passAccount,
  passToken,
  reachSummary,
  step,
} from './onboarding.test-helper.ts';
import type { Request } from '../../test/render.test-helper.tsx';

const wrongToken = () =>
  errorBody(403, 'invalid_setup_token', 'The setup token is not the one this server printed.');

/** Refuses the first call `matches` with a wrong token, then answers as `server` does. */
const wrongTokenOnce = (matches: (request: Request) => boolean) => {
  let refused = false;
  return (request: Request) => {
    if (refused || !matches(request)) return undefined;
    refused = true;
    return wrongToken();
  };
};

/** The `fetch` of `server`, except that the calls `matches` never reach it. */
const unreachable = (
  server: ReturnType<typeof fakeServer>,
  matches: (request: Request) => boolean,
): typeof globalThis.fetch => {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const request = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: new Headers(),
      credentials: undefined,
      body: undefined,
    };
    return matches(request)
      ? Promise.reject(new TypeError('Failed to fetch'))
      : server.fetch(input, init);
  };
};

describe('the onboarding after a refusal', () => {
  it('drops what a check answered with a token that was refused', async () => {
    renderApp('/', fakeServer(wrongTokenOnce(isSetupCheck), onboardingServer()).fetch);
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);
    await fillModels(user);
    await user.click(screen.getByRole('button', { name: 'Check the language models' }));
    await step('Setup token');

    await next(user);
    await next(user);
    const llm = await step('Language models');
    expect(llm.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops the refusal of the setup once the token is given again', async () => {
    renderApp('/', fakeServer(wrongTokenOnce(isSetup), onboardingServer()).fetch);
    const user = userEvent.setup();
    await reachSummary(user);
    await finish(user);
    await step('Setup token');

    await next(user);
    await next(user);
    await next(user);
    await next(user);
    const summary = await step('Summary');
    expect(summary.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops what a check answered once its fields change', async () => {
    renderApp('/', fakeServer(onboardingServer({ check: () => json({ ...OK_CHECK }) })).fetch);
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);
    await fillModels(user);
    await user.click(screen.getByRole('button', { name: 'Check the language models' }));
    expect(
      await screen.findByRole('list', { name: 'Check of the language models' }),
    ).toBeInTheDocument();

    await user.type((await step('Language models')).getByLabelText('Text model'), '-2');
    expect(
      screen.queryByRole('list', { name: 'Check of the language models' }),
    ).not.toBeInTheDocument();
  });
});

describe('the onboarding without the server', () => {
  it('says a check could not reach the server, and stays', async () => {
    renderApp('/', unreachable(fakeServer(onboardingServer()), isSetupCheck));
    const user = userEvent.setup();
    await passToken(user);
    await passAccount(user);
    await fillModels(user);
    await user.click(screen.getByRole('button', { name: 'Check the language models' }));

    const llm = await step('Language models');
    expect(await llm.findByRole('alert')).toHaveTextContent('The server could not be reached.');
  });

  it('says the setup could not reach the server, and lets it be tried again', async () => {
    renderApp('/', unreachable(fakeServer(onboardingServer()), isSetup));
    const user = userEvent.setup();
    await reachSummary(user);
    await finish(user);

    const summary = await step('Summary');
    expect(await summary.findByRole('alert')).toHaveTextContent('The server could not be reached.');
    expect(screen.getByRole('button', { name: 'Finish and sign in' })).toBeEnabled();
  });
});
