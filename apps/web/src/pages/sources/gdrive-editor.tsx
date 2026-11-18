import { InfoIcon } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { SettingsCard } from '../settings/settings-card.tsx';
import { TextField } from '../settings/settings-fields.tsx';
import { fieldSetter } from '../settings/settings-form.ts';
import { issueAt } from '../settings/settings-validation.ts';
import {
  type GdriveSource,
  type GdriveSourceValues,
  gdriveValuesOf,
  newGdriveValues,
  validateGdriveCreate,
  validateGdrivePatch,
} from './gdrive-form.ts';
import { GeneralFields, SourceForm, type SourceFieldsProps } from './source-editor.tsx';
import { createOutcome, updateOutcome, useSourceSubmit } from './source-submit.ts';

interface FolderFieldsProps extends SourceFieldsProps<GdriveSourceValues> {
  /** A source not saved yet, connected to Google only once it is. */
  readonly isNew: boolean;
}

const FolderFields = ({ values, issues, onChange, isNew }: FolderFieldsProps) => {
  const set = fieldSetter(values, onChange);
  return (
    <SettingsCard
      id="folder"
      title="Drive folder"
      description="The folder read, with its subfolders."
    >
      <TextField
        id="source-folder"
        label="Folder"
        autoComplete="off"
        value={values.folder}
        onChange={set('folder')}
        hint="Its address in Drive (https://drive.google.com/drive/folders/...) or its id, the last part of that address; root for the whole of My Drive."
        error={issueAt(issues, 'config.folder_id')}
      />
      {isNew ? (
        <Alert>
          <InfoIcon />
          <AlertDescription>
            Once saved, connect the source with Google from its card: it is not run before.
          </AlertDescription>
        </Alert>
      ) : null}
    </SettingsCard>
  );
};

/** The form of a new Drive source, or of `source`: a new reading of it gives a new form. */
export const GdriveSourceEditor = ({ source }: { readonly source?: GdriveSource }) => {
  const [values, setValues] = useState<GdriveSourceValues>(() =>
    source === undefined ? newGdriveValues() : gdriveValuesOf(source),
  );
  const submission = useSourceSubmit(() =>
    source === undefined
      ? createOutcome(validateGdriveCreate(values))
      : updateOutcome(source.id, validateGdrivePatch(values, source)),
  );
  const fields = { values, issues: submission.issues, onChange: setValues };

  return (
    <SourceForm submission={submission}>
      <GeneralFields {...fields} description="A Google Drive folder, read on a schedule." />
      <FolderFields {...fields} isNew={source === undefined} />
    </SourceForm>
  );
};
