import { SETUP_BASE_PATH } from '@liasse/contract';
import { screen, within } from '@testing-library/react';
import type { userEvent } from '@testing-library/user-event';
import {
  type Answer,
  authPath,
  json,
  LIVE_SESSION,
  type Request,
} from '../../test/render.test-helper.tsx';
import { OK_CHECK, STATE } from '../settings/settings.test-helper.ts';

export const TOKEN = 'synthetic-setup-token';
export const NAME = 'Owner';
export const EMAIL = 'owner@example.test';
export const PASSWORD = 'synthetic-password';
export const LLM_KEY = 'synthetic-llm-key';

export const isSetupCheck = ({ method, path }: Request) =>
  method === 'POST' && path === `${SETUP_BASE_PATH}/check`;
export const isSetup = ({ method, path }: Request) => method === 'POST' && path === SETUP_BASE_PATH;
export const isSignIn = ({ path }: Request) => path === authPath('/sign-in/email');

const SETUP_RESULT = { email: EMAIL, settings: STATE };

/**
 * A server with no account until a setup succeeds: then the account signs in. A check
 * answers `check`, a setup `setup`; both default to success.
 */
export const onboardingServer = ({
  check = () => json(OK_CHECK),
  setup = () => json(SETUP_RESULT, 201),
}: {
  readonly check?: Answer;
  readonly setup?: Answer;
} = {}): Answer => {
  let accountExists = false;
  let signedIn = false;
  return (request) => {
    if (request.method === 'GET' && request.path === SETUP_BASE_PATH) {
      return json({ needs_setup: !accountExists });
    }
    if (isSetupCheck(request)) return check(request);
    if (isSetup(request)) {
      const answer = setup(request);
      accountExists = answer?.ok === true;
      return answer;
    }
    if (isSignIn(request)) {
      signedIn = accountExists;
      return accountExists
        ? json({ redirect: false, token: 'synthetic-session', user: LIVE_SESSION.user })
        : json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, 401);
    }
    if (request.path === authPath('/get-session') && !signedIn) return json(null);
    if (request.path.startsWith('/types')) return json({ types: [] });
    if (request.path.startsWith('/documents')) {
      return json({ documents: [], total: 0, has_more: false });
    }
    return undefined;
  };
};

export const step = async (name: string) => within(await screen.findByRole('region', { name }));

export const next = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Next' }));
};

// Pasted rather than typed: typing a long value costs a key event per character.
const paste = async (
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  value: string,
): Promise<void> => {
  await user.click(field);
  await user.paste(value);
};

export const passToken = async (user: ReturnType<typeof userEvent.setup>, token = TOKEN) => {
  await paste(user, (await step('Setup token')).getByLabelText('Setup token'), token);
  await next(user);
};

export const passAccount = async (user: ReturnType<typeof userEvent.setup>) => {
  const account = await step('Your account');
  await paste(user, account.getByLabelText('Name'), NAME);
  await paste(user, account.getByLabelText('Email'), EMAIL);
  await paste(user, account.getByLabelText('Password'), PASSWORD);
  await paste(user, account.getByLabelText('Password again'), PASSWORD);
  await next(user);
};

/** Fills the language models, the default provider and its key; stays on the step. */
export const fillModels = async (user: ReturnType<typeof userEvent.setup>) => {
  const llm = await step('Language models');
  await paste(user, llm.getByLabelText('Text model'), 'synthetic-text');
  await paste(user, llm.getByLabelText('Vision model'), 'synthetic-vision');
  await user.click(llm.getByRole('button', { name: 'Set the language model API key' }));
  await paste(user, llm.getByLabelText('language model API key'), LLM_KEY);
};

/** Every step up to the summary, with valid values. */
export const reachSummary = async (user: ReturnType<typeof userEvent.setup>) => {
  await passToken(user);
  await passAccount(user);
  await fillModels(user);
  await next(user);
  await step('Embedder');
  await next(user);
  return step('Summary');
};

export const finish = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Finish and sign in' }));
};
