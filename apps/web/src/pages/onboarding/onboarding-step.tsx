import { AccountStep } from './account-step.tsx';
import type { SettingsValues } from '../settings/settings-form.ts';
import type { OnboardingStep } from './onboarding-steps.ts';
import { EmbedderStep, LanguageModelsStep } from './settings-steps.tsx';
import { SummaryStep } from './summary-step.tsx';
import { TokenStep } from './token-step.tsx';
import type { OnboardingForm } from './use-onboarding-form.ts';
import type { SetupFlow } from './use-setup-flow.ts';

interface OnboardingStepViewProps {
  readonly form: OnboardingForm;
  readonly flow: SetupFlow;
}

/** The form of the current step, wired to the state of the onboarding. */
export const OnboardingStepView = ({ form, flow }: OnboardingStepViewProps) => {
  const go = (to: OnboardingStep) => () => {
    form.setStep(to);
  };
  const settingsStep = (check: SetupFlow['checks'][keyof SetupFlow['checks']]) => ({
    values: form.settings,
    issues: form.settingsIssues,
    onChange: (values: SettingsValues) => {
      form.setSettings(values);
      check.reset();
      flow.complete.reset();
    },
    onIssues: form.setSettingsIssues,
    check,
  });
  switch (form.step) {
    case 'token':
      return (
        <TokenStep
          token={form.token}
          onChange={form.setToken}
          refusal={form.tokenRefusal}
          onNext={(accepted) => {
            flow.forgetCalls();
            form.setToken(accepted);
            form.setTokenRefusal(undefined);
            form.setStep('account');
          }}
        />
      );
    case 'account':
      return (
        <AccountStep
          values={form.accountValues}
          issues={form.accountIssues}
          onChange={(values) => {
            form.setAccountValues(values);
            flow.complete.reset();
          }}
          onIssues={form.setAccountIssues}
          onBack={go('token')}
          onNext={(accepted) => {
            form.setAccount(accepted);
            form.setStep('llm');
          }}
        />
      );
    case 'llm':
      return (
        <LanguageModelsStep
          {...settingsStep(flow.checks.llm)}
          onBack={go('account')}
          onNext={go('embedding')}
        />
      );
    case 'embedding':
      return (
        <EmbedderStep
          {...settingsStep(flow.checks.embedding)}
          onBack={go('llm')}
          onNext={go('summary')}
        />
      );
    case 'summary':
      return form.account === undefined ? null : (
        <SummaryStep
          account={form.account}
          settings={form.settings}
          refusal={flow.complete.error ?? undefined}
          // Pending until the sign-in after the setup leaves the page as well.
          pending={flow.complete.isPending || flow.complete.isSuccess}
          onBack={go('embedding')}
          onFinish={flow.finish}
        />
      );
  }
};
