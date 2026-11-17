import type { Issues } from '../settings/settings-validation.ts';

export const ONBOARDING_STEPS = ['token', 'account', 'llm', 'embedding', 'summary'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const STEP_LABELS: Readonly<Record<OnboardingStep, string>> = {
  token: 'Setup token',
  account: 'Account',
  llm: 'Language models',
  embedding: 'Embedder',
  summary: 'Summary',
};

/** The first step whose fields a refusal of the server names, if any. */
export const firstStepWith = (
  accountIssues: Issues,
  settingsIssues: Issues,
): OnboardingStep | undefined => {
  if (accountIssues.size > 0) return 'account';
  const paths = [...settingsIssues.keys()];
  return (['llm', 'embedding'] as const).find((section) =>
    paths.some((path) => path.startsWith(`${section}.`)),
  );
};
