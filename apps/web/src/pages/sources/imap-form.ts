import {
  imapSourceConfigSchema,
  type Source,
  type SourceCreate,
  type SourcePatch,
  SOURCE_PASSWORD_MISSING_MESSAGE,
  SOURCE_PASSWORD_UNREADABLE_MESSAGE,
} from '@liasse/contract';
import type { ImapSecurity } from '@liasse/contract/domain';
import type { SecretValue } from '../../components/secret-field.tsx';
import { number, numberText, optionalText, text } from '../settings/settings-form.ts';
import { issuesFrom, NO_ISSUES } from '../settings/settings-validation.ts';
import {
  type FormValidation,
  type GeneralSourceValues,
  generalCreateDraftOf,
  generalPatchDraftOf,
  generalValuesOf,
  newGeneralValues,
  parseCreate,
  parsePatch,
} from './source-form.ts';

/** The form of an IMAP source, every input as typed: numbers stay text until the schema reads them. */
export interface ImapSourceValues extends GeneralSourceValues {
  readonly host: string;
  readonly port: string;
  readonly security: ImapSecurity;
  readonly username: string;
  readonly password: SecretValue;
  /** One mailbox per line. */
  readonly mailboxes: string;
  readonly start_date: string;
  readonly from: string;
  readonly subject: string;
  readonly include_messages_without_attachments: boolean;
}

const configShape = imapSourceConfigSchema.shape;

/** A new source: the defaults of the schema, and a password to type. */
export const newImapValues = (): ImapSourceValues => ({
  ...newGeneralValues(),
  host: '',
  port: numberText(configShape.port.parse(undefined)),
  security: configShape.security.parse(undefined),
  username: '',
  password: { state: 'unset', update: { action: 'replace', value: '' } },
  mailboxes: configShape.mailboxes.parse(undefined).join('\n'),
  start_date: '',
  from: '',
  subject: '',
  include_messages_without_attachments:
    configShape.include_messages_without_attachments.parse(undefined),
});

/** A source of the kind this form edits. */
export type ImapSource = Extract<Source, { readonly kind: 'imap' }>;

/** The form showing a saved source, its password kept. */
export const imapValuesOf = (source: ImapSource): ImapSourceValues => ({
  ...generalValuesOf(source),
  host: source.config.host,
  port: numberText(source.config.port),
  security: source.config.security,
  username: source.config.username,
  password: { state: source.secret, update: { action: 'keep' } },
  mailboxes: source.config.mailboxes.join('\n'),
  start_date: source.config.start_date,
  from: text(source.config.from),
  subject: text(source.config.subject),
  include_messages_without_attachments: source.config.include_messages_without_attachments,
});

/**
 * Whether the form points a stored password at another server than the one it was given
 * for: the server refuses to keep it then (`source_secret_required`).
 */
export const needsPasswordAgain = (values: ImapSourceValues, source: ImapSource): boolean =>
  source.secret !== 'unset' &&
  (values.host.trim() !== source.config.host || values.security !== source.config.security);

const PASSWORD_TO_TYPE = { action: 'replace', value: '' } as const;

/**
 * `next` with its password opened for typing when this change points it at another server,
 * and kept again when the change brings it back before anything was typed.
 */
export const followServerChange = (
  previous: ImapSourceValues,
  next: ImapSourceValues,
  source: ImapSource,
): ImapSourceValues => {
  const before = needsPasswordAgain(previous, source);
  const after = needsPasswordAgain(next, source);
  const { update } = next.password;
  if (!before && after && update.action === 'keep') {
    return { ...next, password: { ...next.password, update: PASSWORD_TO_TYPE } };
  }
  if (before && !after && update.action === 'replace' && update.value === '') {
    return { ...next, password: { ...next.password, update: { action: 'keep' } } };
  }
  return next;
};

export const PASSWORD_AGAIN_MESSAGE =
  'The stored password was given for the former server: enter it again.';
export const PASSWORD_REQUIRED_MESSAGE = 'A mailbox is read with its password: enter it.';

// Blank lines between mailboxes are layout; a name keeps its inner spaces.
const mailboxesOf = (lines: string): readonly string[] =>
  lines.split('\n').filter((line) => line.trim() !== '');

const configOf = (values: ImapSourceValues) => ({
  host: values.host,
  port: number(values.port),
  security: values.security,
  username: values.username,
  mailboxes: [...mailboxesOf(values.mailboxes)],
  start_date: values.start_date,
  from: optionalText(values.from),
  subject: optionalText(values.subject),
  include_messages_without_attachments: values.include_messages_without_attachments,
});

// Problems of the password the schema cannot see: they need what is stored, or what the
// first run would meet.
const withPasswordIssue = <Draft>(
  result: FormValidation<Draft>,
  message: string | undefined,
): FormValidation<Draft> => {
  if (message === undefined) return result;
  const issues = result.valid ? NO_ISSUES : result.issues;
  return {
    valid: false,
    issues: issuesFrom([
      { path: 'secret', message },
      ...[...issues].map(([path, issue]) => ({ path, message: issue })),
    ]),
  };
};

/**
 * The form read by the schema the server creates a source with. A new source without a
 * password would only be refused by its first run: the form asks for it.
 */
export const validateImapCreate = (values: ImapSourceValues): FormValidation<SourceCreate> =>
  withPasswordIssue(
    parseCreate({
      kind: 'imap',
      ...generalCreateDraftOf(values),
      config: configOf(values),
      secret: values.password.update,
    }),
    values.password.update.action === 'replace' ? undefined : PASSWORD_REQUIRED_MESSAGE,
  );

// What the server refuses of the password a save leaves, checked here first: the server would
// answer `source_secret_required`.
const passwordIssueOf = (values: ImapSourceValues, source: ImapSource): string | undefined => {
  const { action } = values.password.update;
  if (action === 'replace') return undefined;
  if (action === 'keep' && needsPasswordAgain(values, source)) return PASSWORD_AGAIN_MESSAGE;
  if (!values.enabled) return undefined;
  if (action === 'keep' && source.secret === 'unreadable')
    return SOURCE_PASSWORD_UNREADABLE_MESSAGE;
  return action === 'clear' || source.secret === 'unset'
    ? SOURCE_PASSWORD_MISSING_MESSAGE
    : undefined;
};

/**
 * The fields of `source` the form changes. An enabled source is refused a password it could
 * not run with, as the server would refuse it: one kept for another server, one that no
 * longer opens, or none.
 */
export const validateImapPatch = (
  values: ImapSourceValues,
  source: ImapSource,
): FormValidation<SourcePatch> =>
  withPasswordIssue(
    parsePatch(
      {
        kind: 'imap',
        ...generalPatchDraftOf(values),
        config: configOf(values),
        secret: values.password.update,
      },
      source,
    ),
    passwordIssueOf(values, source),
  );
