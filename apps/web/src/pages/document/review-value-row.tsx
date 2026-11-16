import type { ReviewedValue } from '@liasse/sdk';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { shownValue } from '../../lib/format.ts';
import { confidenceLabel, editTextOf, type ValueDecision } from './review.ts';
import { ChoiceGroup } from './review-choice.tsx';

// Everything below that is read from the document is rendered as React text, never as
// markup.

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
  readAgain,
  onChange,
}: {
  readonly reviewed: ReviewedValue;
  readonly current: unknown;
  readonly decision: ValueDecision;
  /** Why the value is read again rather than decided here; null when it is decided. */
  readonly readAgain: string | null;
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
          {readAgain === null ? null : <p className="text-sm">{readAgain}</p>}
        </div>
        <ChoiceGroup
          label={`Decision for ${reviewed.name}`}
          choices={VALUE_CHOICES}
          value={decision.kind}
          disabled={readAgain !== null}
          onChange={(kind) => {
            onChange(kind === 'edit' ? { kind, text: editTextOf(current) } : { kind });
          }}
        />
      </div>
      {decision.kind === 'edit' && readAgain === null ? (
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
