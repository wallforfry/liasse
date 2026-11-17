import { FolderArchiveIcon } from 'lucide-react';
import { OnboardingStepView } from './onboarding-step.tsx';
import { StepList } from './step-list.tsx';
import { useOnboardingForm } from './use-onboarding-form.ts';
import { useSetupFlow } from './use-setup-flow.ts';

/**
 * The first start: the setup token, the first account, the models and the embedder, then
 * the setup and the sign-in.
 */
export const OnboardingPage = () => {
  const form = useOnboardingForm();
  const flow = useSetupFlow(form);
  return (
    <main className="flex min-h-svh justify-center bg-muted p-6">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FolderArchiveIcon className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">Set up Liasse</h1>
          <StepList current={form.step} />
        </header>
        <OnboardingStepView form={form} flow={flow} />
      </div>
    </main>
  );
};
