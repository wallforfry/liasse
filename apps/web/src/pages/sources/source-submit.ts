import type { SourceCreate, SourcePatch } from '@liasse/contract';
import { type SubmitEvent, useState } from 'react';
import { type Issues, NO_ISSUES } from '../settings/settings-validation.ts';
import type { FormValidation } from './source-form.ts';
import { type SourceSave, useSaveSource } from './use-save-source.ts';

/** A save of a valid form, or the issues of an invalid one. */
export type SaveOutcome = { readonly save: SourceSave } | { readonly issues: Issues };

export const createOutcome = (created: FormValidation<SourceCreate>): SaveOutcome =>
  created.valid
    ? { save: { action: 'create', source: created.draft } }
    : { issues: created.issues };

export const updateOutcome = (id: string, patched: FormValidation<SourcePatch>): SaveOutcome =>
  patched.valid
    ? { save: { action: 'update', id, patch: patched.draft } }
    : { issues: patched.issues };

/** The issues of the form and its submission: `outcome` reads the form when it is sent. */
export const useSourceSubmit = (outcome: () => SaveOutcome) => {
  const [issues, setIssues] = useState<Issues>(NO_ISSUES);
  const save = useSaveSource(setIssues);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const read = outcome();
    if ('issues' in read) {
      setIssues(read.issues);
      return;
    }
    setIssues(NO_ISSUES);
    save.mutate(read.save);
  };
  return { issues, save, submit };
};
