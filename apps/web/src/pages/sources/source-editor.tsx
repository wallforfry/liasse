import {
  MAX_HINT_LENGTH,
  MAX_SOURCE_NAME_LENGTH,
  MAX_SOURCE_POLL_MINUTES,
} from '@liasse/contract/domain';
import { type SubmitEvent, useState } from 'react';
import { Link } from 'react-router';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { SOURCES_PATH } from '../../layout/navigation.ts';
import { SettingsCard } from '../settings/settings-card.tsx';
import { TextField } from '../settings/settings-fields.tsx';
import { fieldSetter } from '../settings/settings-form.ts';
import { type Issues, issueAt, NO_ISSUES } from '../settings/settings-validation.ts';
import { type ImapFieldsProps, ImapSelectionFields, ImapServerFields } from './imap-fields.tsx';
import {
  type ImapSourceValues,
  followServerChange,
  type ImapSource,
  imapValuesOf,
  needsPasswordAgain,
  newImapValues,
  validateCreate,
  validatePatch,
} from './source-form.ts';
import { type SourceSave, useSaveSource } from './use-save-source.ts';

const GeneralFields = ({ values, issues, onChange }: ImapFieldsProps) => {
  const set = fieldSetter(values, onChange);
  return (
    <SettingsCard id="general" title="Source" description="An IMAP mailbox, read on a schedule.">
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

/** The source a valid form saves, or the issues of an invalid one. */
const saveOf = (
  values: ImapSourceValues,
  source: ImapSource | undefined,
): { readonly save: SourceSave } | { readonly issues: Issues } => {
  if (source === undefined) {
    const created = validateCreate(values);
    return created.valid
      ? { save: { action: 'create', source: created.draft } }
      : { issues: created.issues };
  }
  const patched = validatePatch(values, source);
  return patched.valid
    ? { save: { action: 'update', id: source.id, patch: patched.draft } }
    : { issues: patched.issues };
};

/** The form of a new source, or of `source`: a new reading of it gives a new form. */
export const SourceEditor = ({ source }: { readonly source?: ImapSource }) => {
  const [values, setValues] = useState<ImapSourceValues>(() =>
    source === undefined ? newImapValues() : imapValuesOf(source),
  );
  const [issues, setIssues] = useState<Issues>(NO_ISSUES);
  const save = useSaveSource(setIssues);
  const onChange = (next: ImapSourceValues): void => {
    setValues((previous) =>
      source === undefined ? next : followServerChange(previous, next, source),
    );
  };
  const fields = { values, issues, onChange };
  const passwordAgain = source !== undefined && needsPasswordAgain(values, source);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = saveOf(values, source);
    if ('issues' in outcome) {
      setIssues(outcome.issues);
      return;
    }
    setIssues(NO_ISSUES);
    save.mutate(outcome.save);
  };

  return (
    <form className="flex max-w-2xl flex-col gap-6" onSubmit={submit} noValidate>
      <GeneralFields {...fields} />
      <ImapServerFields {...fields} passwordAgain={passwordAgain} />
      <ImapSelectionFields {...fields} />
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
};
