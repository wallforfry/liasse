import {
  IMAP_SECURITY_MODES,
  type ImapSecurity,
  MAX_IMAP_MAILBOXES,
} from '@liasse/contract/domain';
import { CircleAlertIcon, InfoIcon } from 'lucide-react';
import { SecretField } from '../../components/secret-field.tsx';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { describedBy } from '../settings/field-frame.ts';
import { SettingsCard } from '../settings/settings-card.tsx';
import { ChoiceField, Field, TextField } from '../settings/settings-fields.tsx';
import { fieldSetter } from '../settings/settings-form.ts';
import { type Issues, issueAt } from '../settings/settings-validation.ts';
import { type ImapSourceValues, PASSWORD_AGAIN_MESSAGE } from './source-form.ts';

export interface ImapFieldsProps {
  readonly values: ImapSourceValues;
  readonly issues: Issues;
  readonly onChange: (values: ImapSourceValues) => void;
}

const SECURITY_HINTS: Readonly<Record<ImapSecurity, string>> = {
  tls: 'TLS from the first byte, usually on port 993.',
  starttls: 'A plain connection upgraded with STARTTLS, required; usually on port 143.',
  none: 'No encryption at all.',
};

const GmailHint = () => (
  <Alert>
    <InfoIcon />
    <AlertTitle>Gmail</AlertTitle>
    <AlertDescription>
      Create an app password in your Google account (it needs 2-step verification) and give it as
      the password. The server is imap.gmail.com, port 993, TLS; a label is a folder.
    </AlertDescription>
  </Alert>
);

const ClearTextWarning = () => (
  <Alert variant="destructive">
    <CircleAlertIcon />
    <AlertTitle>The password crosses the network in clear</AlertTitle>
    <AlertDescription>
      Without TLS or STARTTLS, anyone on the way can read the password and the messages. Use it only
      on a network you trust.
    </AlertDescription>
  </Alert>
);

/** The server of the mailbox and how to sign in to it. */
interface ImapServerFieldsProps extends ImapFieldsProps {
  /** The host or the security differs from those the stored password was given for. */
  readonly passwordAgain: boolean;
}

export const ImapServerFields = ({
  values,
  issues,
  onChange,
  passwordAgain,
}: ImapServerFieldsProps) => {
  const set = fieldSetter(values, onChange);
  return (
    <SettingsCard id="server" title="Server" description="Where the mailbox is and how to sign in.">
      <GmailHint />
      <TextField
        id="source-host"
        label="Host"
        value={values.host}
        onChange={set('host')}
        error={issueAt(issues, 'config.host')}
      />
      <TextField
        id="source-port"
        label="Port"
        kind="number"
        value={values.port}
        onChange={set('port')}
        error={issueAt(issues, 'config.port')}
      />
      <ChoiceField
        id="source-security"
        label="Security"
        options={IMAP_SECURITY_MODES}
        value={values.security}
        onChange={set('security')}
        hint={SECURITY_HINTS[values.security]}
        error={issueAt(issues, 'config.security')}
      />
      {values.security === 'none' ? <ClearTextWarning /> : null}
      <TextField
        id="source-username"
        label="User name"
        autoComplete="off"
        value={values.username}
        onChange={set('username')}
        error={issueAt(issues, 'config.username')}
      />
      <SecretField
        id="source-password"
        title="Password"
        noun="password"
        label="mailbox password"
        field={values.password}
        onChange={set('password')}
        error={issueAt(issues, 'secret')}
      />
      {passwordAgain && issueAt(issues, 'secret') === undefined ? (
        <p className="text-sm text-muted-foreground">{PASSWORD_AGAIN_MESSAGE}</p>
      ) : null}
    </SettingsCard>
  );
};

const MailboxesField = ({ values, issues, onChange }: ImapFieldsProps) => {
  const frame = {
    id: 'source-mailboxes',
    label: 'Mailboxes',
    hint: `One per line, at most ${String(MAX_IMAP_MAILBOXES)}. On Gmail, a label is a folder.`,
    error: issueAt(issues, 'config.mailboxes'),
  };
  return (
    <Field frame={frame}>
      <Textarea
        id={frame.id}
        rows={3}
        value={values.mailboxes}
        aria-invalid={frame.error === undefined ? undefined : true}
        aria-describedby={describedBy(frame)}
        onChange={(event) => {
          onChange({ ...values, mailboxes: event.target.value });
        }}
      />
    </Field>
  );
};

/** Which messages of the mailbox are taken. */
export const ImapSelectionFields = ({ values, issues, onChange }: ImapFieldsProps) => {
  const set = fieldSetter(values, onChange);
  return (
    <SettingsCard
      id="selection"
      title="Messages"
      description="A message taken becomes a document, and each of its attachments another."
    >
      <MailboxesField values={values} issues={issues} onChange={onChange} />
      <TextField
        id="source-start-date"
        label="Start date"
        kind="date"
        value={values.start_date}
        onChange={set('start_date')}
        hint="The first run takes the messages received on this day or later."
        error={issueAt(issues, 'config.start_date')}
      />
      <TextField
        id="source-from"
        label="Sender contains (optional)"
        value={values.from}
        onChange={set('from')}
        error={issueAt(issues, 'config.from')}
      />
      <TextField
        id="source-subject"
        label="Subject contains (optional)"
        value={values.subject}
        onChange={set('subject')}
        error={issueAt(issues, 'config.subject')}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="source-without-attachments"
          checked={values.include_messages_without_attachments}
          onCheckedChange={(checked) => {
            set('include_messages_without_attachments')(checked === true);
          }}
        />
        <Label htmlFor="source-without-attachments">Include messages without attachments</Label>
      </div>
    </SettingsCard>
  );
};
