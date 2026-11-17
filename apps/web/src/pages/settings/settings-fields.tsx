import type { ReactNode } from 'react';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { describedBy, type FieldFrame } from './field-frame.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';

/** The label, hint and error of one input of the form. */
export const Field = ({
  frame,
  children,
}: {
  readonly frame: FieldFrame;
  readonly children: ReactNode;
}) => (
  <div className="grid gap-2">
    <Label htmlFor={frame.id}>{frame.label}</Label>
    {children}
    {frame.hint === undefined ? null : (
      <p id={`${frame.id}-hint`} className="text-sm text-muted-foreground">
        {frame.hint}
      </p>
    )}
    {frame.error === undefined ? null : (
      <p id={`${frame.id}-error`} className="text-sm text-destructive">
        {frame.error}
      </p>
    )}
  </div>
);

interface TextFieldProps extends FieldFrame {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly kind?: 'text' | 'number' | 'url' | 'email' | 'password';
  readonly autoComplete?: string;
  readonly maxLength?: number;
  readonly disabled?: boolean;
}

export const TextField = ({
  value,
  onChange,
  kind = 'text',
  autoComplete,
  maxLength,
  disabled,
  ...frame
}: TextFieldProps) => (
  <Field frame={frame}>
    <Input
      id={frame.id}
      type={kind}
      autoComplete={autoComplete}
      maxLength={maxLength}
      step={kind === 'number' ? 'any' : undefined}
      value={value}
      disabled={disabled}
      aria-invalid={frame.error === undefined ? undefined : true}
      aria-describedby={describedBy(frame)}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  </Field>
);

interface ChoiceFieldProps<Choice extends string> extends FieldFrame {
  readonly options: readonly Choice[];
  readonly value: Choice;
  readonly onChange: (value: Choice) => void;
  readonly disabled?: boolean;
}

export const ChoiceField = <Choice extends string>({
  options,
  value,
  onChange,
  disabled,
  ...frame
}: ChoiceFieldProps<Choice>) => (
  <Field frame={frame}>
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const chosen = options.find((option) => option === next);
        if (chosen !== undefined) onChange(chosen);
      }}
    >
      <SelectTrigger
        id={frame.id}
        className="w-56"
        aria-invalid={frame.error === undefined ? undefined : true}
        aria-describedby={describedBy(frame)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </Field>
);
