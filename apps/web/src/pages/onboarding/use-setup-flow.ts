import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useSession } from '../../api/session.ts';
import { firstStepWith } from './onboarding-steps.ts';
import { accountIssuesOf, isSetupDone, isWrongToken, settingsIssuesOf } from './setup-errors.ts';
import { validateSetupSettings } from './setup-validation.ts';
import type { OnboardingForm } from './use-onboarding-form.ts';
import { useCompleteSetup, useSetupCheck } from './use-setup.ts';

const HOME = '/documents';

/**
 * The refusals that concern the whole onboarding rather than the step that met them: a
 * wrong token returns to its step, and a setup finished elsewhere leaves for the login.
 */
const useSetupRefusals = ({ setStep, setTokenRefusal }: OnboardingForm) => {
  const navigate = useNavigate();
  const { setupDone } = useSession();
  const leaveForLogin = (message: string): void => {
    setupDone();
    toast.info(message);
    void navigate('/login', { replace: true });
  };
  const handled = (error: unknown): boolean => {
    if (isWrongToken(error)) {
      setTokenRefusal(error);
      setStep('token');
      return true;
    }
    if (isSetupDone(error)) {
      leaveForLogin('An account exists already: sign in with it.');
      return true;
    }
    return false;
  };
  return { handled, leaveForLogin };
};

/** The calls of the onboarding: the check of each settings step, and the setup itself. */
export const useSetupFlow = (form: OnboardingForm) => {
  const navigate = useNavigate();
  const { logIn, setupDone } = useSession();
  const refusals = useSetupRefusals(form);
  const onCheckError = (error: Error): void => {
    if (refusals.handled(error)) return;
    const issues = settingsIssuesOf(error);
    if (issues.size > 0) form.setSettingsIssues(issues);
  };
  const checks = {
    llm: useSetupCheck(form.token, onCheckError),
    embedding: useSetupCheck(form.token, onCheckError),
  };
  const complete = useCompleteSetup();

  const signIn = (email: string, password: string): void => {
    logIn(email, password).then(
      () => {
        setupDone();
        void navigate(HOME, { replace: true });
      },
      () => {
        refusals.leaveForLogin('Your account is created and the settings saved: sign in.');
      },
    );
  };
  const onRefused = (error: Error): void => {
    if (refusals.handled(error)) return;
    const refusedAccount = accountIssuesOf(error);
    const refusedSettings = settingsIssuesOf(error);
    form.setAccountIssues(refusedAccount);
    form.setSettingsIssues(refusedSettings);
    form.setStep(firstStepWith(refusedAccount, refusedSettings) ?? 'summary');
  };
  const finish = (): void => {
    const { account, token } = form;
    const validation = validateSetupSettings(form.settings);
    if (account === undefined || !validation.valid) return;
    complete.mutate(
      { token, account, settings: validation.draft },
      {
        onSuccess: ({ email }) => {
          signIn(email, account.password);
        },
        onError: onRefused,
      },
    );
  };
  return { checks, complete, finish };
};

export type SetupFlow = ReturnType<typeof useSetupFlow>;
