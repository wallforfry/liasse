import type { DocumentReview, ReviewedValue } from '@liasse/sdk';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { shownValue } from '../../lib/format.ts';
import { editTextOf, percent, type ValueDecision } from './review.ts';
import { TypePicker } from './type-picker.tsx';

// Everything below that is read from the document is rendered as React text, never as
// markup.

interface Choice<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

/** A choice of one among a few, as pressed buttons. */
const ChoiceGroup = <Value extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  readonly label: string;
  readonly choices: readonly Choice<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}) => (
  <div role="group" aria-label={label} className="flex flex-wrap gap-1">
    {choices.map((choice) => (
      <Button
        key={choice.value}
        type="button"
        size="sm"
        variant={choice.value === value ? 'default' : 'outline'}
        aria-pressed={choice.value === value}
        onClick={() => {
          onChange(choice.value);
        }}
      >
        {choice.label}
      </Button>
    ))}
  </div>
);

const confidenceLabel = (confidence: number | null): string =>
  confidence === null ? 'confidence unknown' : `confidence ${percent(confidence)}`;

const TYPE_CHOICES = [
  { value: 'accept', label: 'Accept' },
  { value: 'change', label: 'Change' },
] as const;

export const TypeRow = ({
  current,
  type,
  value,
  onChange,
}: {
  /** The slug of the type the document has, null for an untyped one. */
  readonly current: string | null;
  readonly type: DocumentReview['type'];
  readonly value: string;
  readonly onChange: (slug: string) => void;
}) => {
  const changing = current === null || value !== current;
  return (
    <div className="flex flex-col gap-2 border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Type: {current ?? 'untyped'}</p>
          <p className="text-sm text-muted-foreground">
            {type.manual ? 'chosen by hand' : confidenceLabel(type.confidence)}
          </p>
        </div>
        {current === null ? null : (
          <ChoiceGroup
            label="Decision for the type"
            choices={TYPE_CHOICES}
            value={changing ? 'change' : 'accept'}
            onChange={(choice) => {
              onChange(choice === 'accept' ? current : '');
            }}
          />
        )}
      </div>
      {changing ? (
        <div className="grid max-w-md gap-2">
          <Label htmlFor="review-type">Type</Label>
          <TypePicker id="review-type" value={value} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
};

const VALUE_CHOICES = [
  { value: 'accept', label: 'Accept' },
  { value: 'reject', label: 'Reject' },
  { value: 'edit', label: 'Edit' },
] as const;

const EditInput = ({
  id,
  current,
  text,
  onChange,
}: {
  readonly id: string;
  readonly current: unknown;
  readonly text: string;
  readonly onChange: (text: string) => void;
}) =>
  typeof current === 'string' ? (
    <Input
      id={id}
      value={text}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ) : (
    <Textarea
      id={id}
      className="min-h-24 font-mono text-xs"
      value={text}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );

export const ValueRow = ({
  reviewed,
  current,
  decision,
  onChange,
}: {
  readonly reviewed: ReviewedValue;
  readonly current: unknown;
  readonly decision: ValueDecision;
  readonly onChange: (decision: ValueDecision) => void;
}) => {
  const inputId = `review-${reviewed.section}-${reviewed.name}`;
  return (
    <div className="flex flex-col gap-2 border-b pb-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{reviewed.name}</p>
          <p className="break-words">{shownValue(current)}</p>
          <p className="text-sm text-muted-foreground">
            {confidenceLabel(reviewed.confidence)}
            {reviewed.page === null ? '' : `, page ${String(reviewed.page)}`}
          </p>
          {reviewed.quote === null ? null : (
            <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">
              {reviewed.quote}
            </blockquote>
          )}
        </div>
        <ChoiceGroup
          label={`Decision for ${reviewed.name}`}
          choices={VALUE_CHOICES}
          value={decision.kind}
          onChange={(kind) => {
            onChange(kind === 'edit' ? { kind, text: editTextOf(current) } : { kind });
          }}
        />
      </div>
      {decision.kind === 'edit' ? (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>New value of {reviewed.name}</Label>
          <EditInput
            id={inputId}
            current={current}
            text={decision.text}
            onChange={(text) => {
              onChange({ kind: 'edit', text });
            }}
          />
        </div>
      ) : null}
    </div>
  );
};
