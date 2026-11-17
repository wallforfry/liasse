import { Button } from '../../components/ui/button.tsx';

interface StepActionsProps {
  /** The previous step; none on the first one. */
  readonly onBack?: () => void;
  readonly submitLabel?: string;
  readonly pending?: boolean;
}

/** The buttons under a step: back to the previous one, and the submit of its form. */
export const StepActions = ({
  onBack,
  submitLabel = 'Next',
  pending = false,
}: StepActionsProps) => (
  <div className="flex gap-2">
    {onBack === undefined ? null : (
      <Button type="button" variant="outline" disabled={pending} onClick={onBack}>
        Back
      </Button>
    )}
    <Button type="submit" disabled={pending}>
      {submitLabel}
    </Button>
  </div>
);
