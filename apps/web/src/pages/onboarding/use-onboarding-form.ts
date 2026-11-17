import type { SetupAccount } from '@liasse/contract';
import { useState } from 'react';
import { type SettingsValues, valuesOf } from '../settings/settings-form.ts';
import { type Issues, NO_ISSUES } from '../settings/settings-validation.ts';
import type { OnboardingStep } from './onboarding-steps.ts';
import { type AccountValues, EMPTY_ACCOUNT } from './setup-validation.ts';

/**
 * Everything the onboarding holds between its steps. The token, the keys and the password
 * stay in this state, never in storage: a reload starts again from the token.
 */
export const useOnboardingForm = () => {
  const [step, setStep] = useState<OnboardingStep>('token');
  const [token, setToken] = useState('');
  const [tokenRefusal, setTokenRefusal] = useState<unknown>(undefined);
  const [accountValues, setAccountValues] = useState<AccountValues>(EMPTY_ACCOUNT);
  const [account, setAccount] = useState<SetupAccount | undefined>(undefined);
  const [accountIssues, setAccountIssues] = useState<Issues>(NO_ISSUES);
  const [settings, setSettings] = useState<SettingsValues>(() => valuesOf(null));
  const [settingsIssues, setSettingsIssues] = useState<Issues>(NO_ISSUES);
  return {
    step,
    setStep,
    token,
    setToken,
    tokenRefusal,
    setTokenRefusal,
    accountValues,
    setAccountValues,
    account,
    setAccount,
    accountIssues,
    setAccountIssues,
    settings,
    setSettings,
    settingsIssues,
    setSettingsIssues,
  };
};

export type OnboardingForm = ReturnType<typeof useOnboardingForm>;
