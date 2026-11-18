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
import { type Issues, issuesFrom } from '../settings/settings-validation.ts';

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
});

/** The form showing a saved source, its password kept. */
export const imapValuesOf = (source: Source): ImapSourceValues => ({
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
});

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

/** The form read by the schema the server creates a source with. */
export const validateCreate = (values: ImapSourceValues): FormValidation<SourceCreate> =>
  validation(sourceCreateSchema.safeParse(draftOf(values)));

/** The form read by the schema the server saves a source with: every field is sent. */
export const validatePatch = (values: ImapSourceValues): FormValidation<SourcePatch> =>
  validation(sourcePatchSchema.safeParse(draftOf(values)));
