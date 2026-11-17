import type {
  SetupCheckRequest,
  SetupRequest,
  SetupResult,
  SetupStatus,
  SettingsCheck,
} from '@liasse/contract';
import type { Auth } from '../auth/create-auth.ts';
import { createFirstAccount, hasAccount } from '../auth/first-account.ts';
import { checkSettings } from '../settings/check.ts';
import { NO_KEYS } from '../settings/keys.ts';
import { resolveSettings } from '../settings/resolve.ts';
import type { SetupToken } from '../setup/token.ts';
import { storedSettingsVersion, writeSettings } from '../settings/store.ts';
import { ApiError } from './errors.ts';
import {
  prepareSettings,
  readSettingsState,
  settingsCandidate,
  type SettingsContext,
} from './settings.ts';

/** What the onboarding needs, before any account exists. */
export interface SetupContext {
  readonly settings: SettingsContext;
  readonly auth: Auth;
  /** Undefined when an account existed at startup: no token was issued. */
  readonly token: SetupToken | undefined;
}

const setupDone = (): ApiError =>
  new ApiError(
    'conflict',
    'setup_done',
    'An account exists already: sign in, and change the settings from the web UI.',
  );

// After the account check: once an account exists, no token is worth anything.
const checkToken = (token: SetupToken | undefined, candidate: string): void => {
  if (token?.matches(candidate) !== true) {
    throw new ApiError(
      'forbidden',
      'invalid_setup_token',
      'The setup token is not the one this server printed at startup.',
    );
  }
};

const admit = async ({ settings, token }: SetupContext, candidate: string): Promise<void> => {
  if (await hasAccount(settings.db)) throw setupDone();
  checkToken(token, candidate);
};

/** Whether the onboarding is still to be done: no account exists. */
export const readSetupStatus = async ({ settings }: SetupContext): Promise<SetupStatus> => ({
  needs_setup: !(await hasAccount(settings.db)),
});

/**
 * Tries settings without saving them, for an onboarding that holds the setup token. No
 * key is kept: before the first account, there is none to keep.
 */
export const checkSetup = async (
  context: SetupContext,
  { token, settings }: SetupCheckRequest,
): Promise<SettingsCheck> => {
  await admit(context, token);
  const { factories, embedding } = context.settings;
  return checkSettings(factories, resolveSettings(settingsCandidate(settings, NO_KEYS), embedding));
};

const settingsMoved = (): ApiError =>
  new ApiError(
    'conflict',
    'settings_conflict',
    'The settings were saved by another process meanwhile. Try again.',
  );

/**
 * Creates the first account and saves the settings in one transaction, under the lock of
 * the first account, and puts them in force in it. Of concurrent setups one creates the
 * account; the others are refused and save nothing. Settings left by an earlier run are
 * replaced, and no key of theirs is kept.
 */
export const completeSetup = async (
  context: SetupContext,
  { token, account, settings: draft }: SetupRequest,
): Promise<SetupResult> => {
  await admit(context, token);
  const { settings: settingsContext, auth } = context;
  const settings = settingsCandidate(draft, NO_KEYS);
  const expectedVersion = await storedSettingsVersion(settingsContext.db);
  const parts = await prepareSettings(settingsContext, settings, expectedVersion + 1);
  const outcome = await createFirstAccount(auth, settingsContext.db, account, {
    alongside: async (tx) => {
      const store = { db: tx, secrets: settingsContext.secrets };
      if ((await writeSettings(store, { expectedVersion, settings })) === undefined) {
        throw settingsMoved();
      }
      parts.putInForce();
    },
  }).catch(async (error: unknown) => {
    await parts.discard();
    throw error;
  });
  if (outcome === 'exists') {
    await parts.discard();
    throw setupDone();
  }
  await parts.settle();
  return { email: account.email, settings: await readSettingsState(settingsContext) };
};
