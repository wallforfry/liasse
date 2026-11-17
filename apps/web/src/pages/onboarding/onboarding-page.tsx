import { FolderArchiveIcon } from 'lucide-react';
import { type RefObject, useEffect, useRef } from 'react';
import type { OnboardingStep } from './onboarding-steps.ts';
import { OnboardingStepView } from './onboarding-step.tsx';
import { StepList } from './step-list.tsx';
import { useOnboardingForm } from './use-onboarding-form.ts';
import { useSetupFlow } from './use-setup-flow.ts';

/**
 * Moves the focus to the heading of each new step, so that a keyboard or a screen reader
 * starts from it rather than from a button of the step that left. The first step keeps the
 * focus its input asks for.
 */
const useFocusOnNewStep = (step: OnboardingStep): RefObject<HTMLElement | null> => {
  const page = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    page.current?.querySelector<HTMLElement>('[data-slot="card-title"]')?.focus();
  }, [step]);
  return page;
};

/**
 * The first start: the setup token, the first account, the models and the embedder, then
 * the setup and the sign-in.
 */
export const OnboardingPage = () => {
  const form = useOnboardingForm();
  const flow = useSetupFlow(form);
  const page = useFocusOnNewStep(form.step);
  return (
    <main ref={page} className="flex min-h-svh justify-center bg-muted p-6">
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
