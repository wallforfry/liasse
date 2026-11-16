import { Button } from '../../components/ui/button.tsx';

export interface Choice<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

/** A choice of one among a few, as pressed buttons. */
export const ChoiceGroup = <Value extends string>({
  label,
  choices,
  value,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly choices: readonly Choice<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly disabled?: boolean;
}) => (
  <div role="group" aria-label={label} className="flex flex-wrap gap-1">
    {choices.map((choice) => (
      <Button
        key={choice.value}
        type="button"
        size="sm"
        variant={choice.value === value ? 'default' : 'outline'}
        aria-pressed={choice.value === value}
        disabled={disabled}
        onClick={() => {
          onChange(choice.value);
        }}
      >
        {choice.label}
      </Button>
    ))}
  </div>
);
