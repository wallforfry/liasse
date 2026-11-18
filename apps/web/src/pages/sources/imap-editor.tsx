import { useState } from 'react';
import { ImapSelectionFields, ImapServerFields } from './imap-fields.tsx';
import {
  followServerChange,
  type ImapSource,
  type ImapSourceValues,
  imapValuesOf,
  needsPasswordAgain,
  newImapValues,
  validateImapCreate,
  validateImapPatch,
} from './imap-form.ts';
import { GeneralFields, SourceForm } from './source-editor.tsx';
import { createOutcome, updateOutcome, useSourceSubmit } from './source-submit.ts';

/** The form of a new mailbox, or of `source`: a new reading of it gives a new form. */
export const ImapSourceEditor = ({ source }: { readonly source?: ImapSource }) => {
  const [values, setValues] = useState<ImapSourceValues>(() =>
    source === undefined ? newImapValues() : imapValuesOf(source),
  );
  const submission = useSourceSubmit(() =>
    source === undefined
      ? createOutcome(validateImapCreate(values))
      : updateOutcome(source.id, validateImapPatch(values, source)),
  );
  const onChange = (next: ImapSourceValues): void => {
    setValues((previous) =>
      source === undefined ? next : followServerChange(previous, next, source),
    );
  };
  const fields = { values, issues: submission.issues, onChange };
  const passwordAgain = source !== undefined && needsPasswordAgain(values, source);

  return (
    <SourceForm submission={submission}>
      <GeneralFields {...fields} description="An IMAP mailbox, read on a schedule." />
      <ImapServerFields {...fields} passwordAgain={passwordAgain} />
      <ImapSelectionFields {...fields} />
    </SourceForm>
  );
};
