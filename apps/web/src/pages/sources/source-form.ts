import {
  imapSourceConfigSchema,
  type Source,
  type SourceCreate,
  sourceCreateSchema,
  type SourceCreateInput,
  type SourcePatch,
  sourcePatchSchema,
} from '@liasse/contract';
import { DEFAULT_SOURCE_POLL_MINUTES, type ImapSecurity } from '@liasse/contract/domain';
import type { z } from 'zod';
import type { SecretValue } from '../../components/secret-field.tsx';
import { number, numberText, optionalText, text } from '../settings/settings-form.ts';
import { type Issues, issuesFrom, NO_ISSUES } from '../settings/settings-validation.ts';

/** The form of an IMAP source, every input as typed: numbers stay text until the schema reads them. */
export interface ImapSourceValues {
  readonly name: string;
  readonly enabled: boolean;
  readonly poll_interval_minutes: string;
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
  /** Given with every document of the source. */
  readonly hint: string;
  readonly private: boolean;
}

const configShape = imapSourceConfigSchema.shape;

/** A new source: the defaults of the schema, and a password to type. */
export const newImapValues = (): ImapSourceValues => ({
  name: '',
  enabled: true,
  poll_interval_minutes: numberText(DEFAULT_SOURCE_POLL_MINUTES),
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
  hint: '',
  private: false,
});

/** The form showing a saved source, its password kept. */
/** A source of the one kind this form edits. */
export type ImapSource = Extract<Source, { readonly kind: 'imap' }>;

export const imapValuesOf = (source: ImapSource): ImapSourceValues => ({
  name: source.name,
  enabled: source.enabled,
  poll_interval_minutes: numberText(source.poll_interval_minutes),
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
  hint: text(source.hint ?? undefined),
  private: source.private,
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
export const PASSWORD_UNREADABLE_MESSAGE =
  'The stored password no longer opens under the current AUTH_SECRET: enter it again.';
export const PASSWORD_REQUIRED_MESSAGE = 'A mailbox is read with its password: enter it.';

// Blank lines between mailboxes are layout; a name keeps its inner spaces.
const mailboxesOf = (lines: string): readonly string[] =>
  lines.split('\n').filter((line) => line.trim() !== '');

/** The source the form sends, before the schema reads it. */
const draftOf = (values: ImapSourceValues) =>
  ({
    kind: 'imap',
    name: values.name,
    enabled: values.enabled,
    poll_interval_minutes: number(values.poll_interval_minutes),
    config: {
      host: values.host,
      port: number(values.port),
      security: values.security,
      username: values.username,
      mailboxes: [...mailboxesOf(values.mailboxes)],
      start_date: values.start_date,
      from: optionalText(values.from),
      subject: optionalText(values.subject),
      include_messages_without_attachments: values.include_messages_without_attachments,
    },
    secret: values.password.update,
    private: values.private,
  }) satisfies SourceCreateInput;

export type FormValidation<Draft> =
  | { readonly valid: true; readonly draft: Draft }
  | { readonly valid: false; readonly issues: Issues };

const validation = <Draft>(result: z.ZodSafeParseResult<Draft>): FormValidation<Draft> =>
  result.success
    ? { valid: true, draft: result.data }
    : {
        valid: false,
        issues: issuesFrom(
          result.error.issues.map(({ path, message }) => ({
            path: path.map(String).join('.'),
            message,
          })),
        ),
      };

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
export const validateCreate = (values: ImapSourceValues): FormValidation<SourceCreate> =>
  withPasswordIssue(
    validation(
      sourceCreateSchema.safeParse({ ...draftOf(values), hint: optionalText(values.hint) }),
    ),
    values.password.update.action === 'replace' ? undefined : PASSWORD_REQUIRED_MESSAGE,
  );

// An emptied hint is removed; an empty one that was never stored is left out.
const hintPatch = (hint: string, source: Source): string | null | undefined =>
  optionalText(hint) ?? (source.hint === null ? undefined : null);

/**
 * The form read by the schema the server saves `source` with: every field is sent. A stored
 * password kept for another server is refused here as the server would, and one that no
 * longer opens, which the next run would only meet as refused credentials.
 */
export const validatePatch = (
  values: ImapSourceValues,
  source: ImapSource,
): FormValidation<SourcePatch> => {
  const result = validation(
    sourcePatchSchema.safeParse({ ...draftOf(values), hint: hintPatch(values.hint, source) }),
  );
  const kept = values.password.update.action === 'keep';
  const message = !kept
    ? undefined
    : source.secret === 'unreadable'
      ? PASSWORD_UNREADABLE_MESSAGE
      : needsPasswordAgain(values, source)
        ? PASSWORD_AGAIN_MESSAGE
        : undefined;
  return withPasswordIssue(result, message);
};
