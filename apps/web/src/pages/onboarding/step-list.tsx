import { cn } from '../../lib/utils.ts';
import { ONBOARDING_STEPS, type OnboardingStep, STEP_LABELS } from './onboarding-steps.ts';

/** Where the person is in the onboarding: the steps in order, the current one marked. */
export const StepList = ({ current }: { readonly current: OnboardingStep }) => {
  const position = ONBOARDING_STEPS.indexOf(current);
  return (
    <ol aria-label="Onboarding steps" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {ONBOARDING_STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={step === current ? 'step' : undefined}
          className={cn(
            index === position ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {`${String(index + 1)}. ${STEP_LABELS[step]}`}
        </li>
      ))}
    </ol>
  );
};
