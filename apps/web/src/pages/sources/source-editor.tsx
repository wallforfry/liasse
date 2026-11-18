import {
  MAX_HINT_LENGTH,
  MAX_SOURCE_NAME_LENGTH,
  MAX_SOURCE_POLL_MINUTES,
} from '@liasse/contract/domain';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { SOURCES_PATH } from '../../layout/navigation.ts';
import { SettingsCard } from '../settings/settings-card.tsx';
import { TextField } from '../settings/settings-fields.tsx';
import { fieldSetter } from '../settings/settings-form.ts';
import { type Issues, issueAt } from '../settings/settings-validation.ts';
import type { GeneralSourceValues } from './source-form.ts';
import type { useSourceSubmit } from './source-submit.ts';

/** What the fields of one card of a source form take. */
export interface SourceFieldsProps<Values> {
  readonly values: Values;
  readonly issues: Issues;
  readonly onChange: (values: Values) => void;
}

interface GeneralFieldsProps<Values> extends SourceFieldsProps<Values> {
  /** What the source is, such as `An IMAP mailbox, read on a schedule.` */
  readonly description: string;
}

/** The name, schedule, hint and flags every kind of source has. */
export const GeneralFields = <Values extends GeneralSourceValues>({
  values,
  issues,
  onChange,
  description,
}: GeneralFieldsProps<Values>) => {
  const set = fieldSetter(values, onChange);
  return (
    <SettingsCard id="general" title="Source" description={description}>
      <TextField
        id="source-name"
        label="Name"
        maxLength={MAX_SOURCE_NAME_LENGTH}
        value={values.name}
        onChange={set('name')}
        error={issueAt(issues, 'name')}
      />
      <TextField
        id="source-interval"
        label="Minutes between runs"
        kind="number"
        value={values.poll_interval_minutes}
        onChange={set('poll_interval_minutes')}
        hint={`From 1 to ${String(MAX_SOURCE_POLL_MINUTES)}.`}
        error={issueAt(issues, 'poll_interval_minutes')}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="source-enabled"
          checked={values.enabled}
          onCheckedChange={(checked) => {
            set('enabled')(checked === true);
          }}
        />
        <Label htmlFor="source-enabled">Enabled</Label>
      </div>
      <TextField
        id="source-hint"
        label="Hint (optional)"
        maxLength={MAX_HINT_LENGTH}
        value={values.hint}
        onChange={set('hint')}
        hint="Given with every document of the source, as the hint of an upload."
        error={issueAt(issues, 'hint')}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="source-private"
          checked={values.private}
          onCheckedChange={(checked) => {
            set('private')(checked === true);
          }}
        />
        <Label htmlFor="source-private">Private: flag every document of the source private</Label>
      </div>
    </SettingsCard>
  );
};

interface SourceFormProps {
  readonly submission: ReturnType<typeof useSourceSubmit>;
  readonly children: ReactNode;
}

/** The form of a source around the cards of its kind: what is wrong, and the buttons. */
export const SourceForm = ({ submission: { issues, save, submit }, children }: SourceFormProps) => (
  <form className="flex max-w-2xl flex-col gap-6" onSubmit={submit} noValidate>
    {children}
    <p role="status" className="text-sm text-destructive">
      {issues.size === 0 ? null : 'Some fields are not valid: see the marked fields.'}
    </p>
    {save.error === null ? null : <ErrorAlert error={save.error} title="Source not saved" />}
    <div className="flex gap-2">
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving...' : 'Save the source'}
      </Button>
      <Button type="button" variant="outline" asChild>
        <Link to={SOURCES_PATH}>Cancel</Link>
      </Button>
    </div>
  </form>
);
