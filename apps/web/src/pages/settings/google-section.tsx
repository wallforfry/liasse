import { GOOGLE_CALLBACK_PATH } from '@liasse/contract';
import { SecretField } from '../../components/secret-field.tsx';
import { SettingsCard } from './settings-card.tsx';
import { TextField } from './settings-fields.tsx';
import { fieldSetter, type SectionProps } from './settings-form.ts';
import { issueAt } from './settings-validation.ts';

interface GoogleSectionProps extends SectionProps<'google'> {
  /** `PUBLIC_URL`, which the server builds the redirect URI from, as this one is built. */
  readonly publicUrl: string;
}

export const GoogleSection = ({ values, issues, onChange, publicUrl }: GoogleSectionProps) => {
  const set = fieldSetter(values, onChange);
  return (
    <SettingsCard
      id="google"
      title="Google"
      description="Optional: the OAuth client of your Google Cloud project, which the Google Drive sources connect with."
    >
      <p className="text-sm text-muted-foreground">
        Register{' '}
        <code className="break-all font-mono text-foreground">
          {new URL(GOOGLE_CALLBACK_PATH, publicUrl).toString()}
        </code>{' '}
        as an authorized redirect URI of a Web application client, and move the app to In
        production: in Testing, Google ends the authorization of a source after 7 days.
      </p>
      <TextField
        id="google-client-id"
        label="Client id"
        autoComplete="off"
        value={values.client_id}
        onChange={set('client_id')}
        error={issueAt(issues, 'google.client_id')}
      />
      <SecretField
        title="Client secret"
        noun="secret"
        id="google-client-secret"
        label="Google client secret"
        field={values.client_secret}
        onChange={set('client_secret')}
        error={issueAt(issues, 'google.client_secret')}
      />
    </SettingsCard>
  );
};
