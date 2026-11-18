import { z } from 'zod';
import {
  DEFAULT_SOURCE_POLL_MINUTES,
  MAX_FILENAME_LENGTH,
  MAX_HINT_LENGTH,
  MAX_IMAP_MAILBOXES,
  MAX_SOURCE_NAME_LENGTH,
  MAX_SOURCE_POLL_MINUTES,
  MAX_SOURCE_SKIPPED_ITEMS,
  SOURCE_CHECK_SAMPLE,
} from './domain/limits.ts';
import { imapSecuritySchema, secretStateSchema, sourceErrorKindSchema } from './domain/schemas.ts';
import { idSchema } from './id.ts';
import { keyUpdateSchema } from './settings.ts';

// The ingestion sources configured in the web UI. Their routes take the session cookie only,
// since a source holds credentials; no answer holds a secret.

const MAX_HOST_LENGTH = 253;
const MAX_USERNAME_LENGTH = 320;
const MAX_MAILBOX_LENGTH = 255;
const MAX_SEARCH_TEXT_LENGTH = 255;
const MAX_ERROR_MESSAGE_LENGTH = 1000;

const searchText = z.string().trim().min(1).max(MAX_SEARCH_TEXT_LENGTH);

export const imapSourceConfigSchema = z.strictObject({
  host: z.string().trim().min(1).max(MAX_HOST_LENGTH),
  port: z.int().min(1).max(65_535).default(993),
  security: imapSecuritySchema.default('tls'),
  username: z.string().trim().min(1).max(MAX_USERNAME_LENGTH),
  mailboxes: z
    .array(z.string().trim().min(1).max(MAX_MAILBOX_LENGTH))
    .min(1)
    .max(MAX_IMAP_MAILBOXES)
    .refine((names) => new Set(names).size === names.length, 'a mailbox is named twice')
    .default(['INBOX'])
    .describe('Folders to read; on Gmail, a label is a folder.'),
  start_date: z.iso
    .date()
    .describe('The first run takes the messages received on this day or later.'),
  from: searchText.optional().describe('Only messages whose sender contains this text.'),
  subject: searchText.optional().describe('Only messages whose subject contains this text.'),
  include_messages_without_attachments: z
    .boolean()
    .default(false)
    .describe('Off: a message is taken only when it has at least one attached file.'),
});
export type ImapSourceConfig = z.output<typeof imapSourceConfigSchema>;
export type ImapSourceConfigInput = z.input<typeof imapSourceConfigSchema>;

// A Drive id is letters, digits, `-` and `_`; `root` names the top of My Drive.
const DRIVE_ID = /^[\w-]{1,200}$/;

export const gdriveSourceConfigSchema = z.strictObject({
  folder_id: z
    .string()
    .trim()
    .regex(DRIVE_ID, 'a Drive folder id: the last part of the address of the folder')
    .describe('The folder read with its subfolders; `root` for the whole of My Drive.'),
});
export type GdriveSourceConfig = z.output<typeof gdriveSourceConfigSchema>;
export type GdriveSourceConfigInput = z.input<typeof gdriveSourceConfigSchema>;

const sourceName = z.string().trim().min(1).max(MAX_SOURCE_NAME_LENGTH);
const sourceHint = z
  .string()
  .trim()
  .min(1)
  .max(MAX_HINT_LENGTH)
  .describe('Given with every document of the source, as the hint of an upload.');
const sourcePrivate = z
  .boolean()
  .describe('Flags every document of the source private, as `private` of an upload does.');
const pollInterval = z
  .int()
  .min(1)
  .max(MAX_SOURCE_POLL_MINUTES)
  .describe('Minutes between two runs.');

export const sourceErrorSchema = z.strictObject({
  kind: sourceErrorKindSchema,
  message: z.string().max(MAX_ERROR_MESSAGE_LENGTH),
});
export type SourceError = z.output<typeof sourceErrorSchema>;

export const sourceSkippedItemSchema = z.strictObject({
  external_id: z.string(),
  name: z.string().max(MAX_FILENAME_LENGTH),
  reason: z.string().max(MAX_ERROR_MESSAGE_LENGTH),
});
export type SourceSkippedItem = z.output<typeof sourceSkippedItemSchema>;

export const sourceRunSchema = z.strictObject({
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  ingested: z.int().min(0).describe('Items that became new documents.'),
  duplicates: z
    .int()
    .min(0)
    .describe('Items whose bytes already had a document, deleted ones included.'),
  skipped: z.int().min(0).describe('Items refused for good; the next runs do not take them.'),
  removed: z
    .int()
    .min(0)
    .default(0)
    .describe('Documents whose file the source no longer holds; they and their knowledge stay.'),
  replaced: z
    .int()
    .min(0)
    .default(0)
    .describe('Documents deleted because the source now holds a new version of their file.'),
  skipped_items: z
    .array(sourceSkippedItemSchema)
    .max(MAX_SOURCE_SKIPPED_ITEMS)
    .describe('The first skipped items and why.'),
  error: sourceErrorSchema.nullable().describe('What ended the run early, if anything did.'),
});
export type SourceRun = z.output<typeof sourceRunSchema>;

const viewFields = {
  id: idSchema,
  name: z.string(),
  enabled: z.boolean(),
  poll_interval_minutes: z.int(),
  hint: z.string().nullable(),
  private: z.boolean(),
  secret: secretStateSchema,
  needs_attention: z
    .boolean()
    .describe('The credentials were refused: polling stopped until the source is saved again.'),
  last_run: sourceRunSchema.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
};

export const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('imap'), config: imapSourceConfigSchema, ...viewFields }),
  z.strictObject({ kind: z.literal('gdrive'), config: gdriveSourceConfigSchema, ...viewFields }),
]);
export type Source = z.output<typeof sourceSchema>;

export const sourceListSchema = z.strictObject({ sources: z.array(sourceSchema) });
export type SourceList = z.output<typeof sourceListSchema>;

export const sourceCreateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('imap'),
    name: sourceName,
    enabled: z.boolean().default(true),
    poll_interval_minutes: pollInterval.default(DEFAULT_SOURCE_POLL_MINUTES),
    hint: sourceHint.optional(),
    private: sourcePrivate.default(false),
    config: imapSourceConfigSchema,
    secret: keyUpdateSchema.describe('The password of the mailbox.'),
  }),
  z.strictObject({
    kind: z.literal('gdrive'),
    name: sourceName,
    enabled: z.boolean().default(true),
    poll_interval_minutes: pollInterval.default(DEFAULT_SOURCE_POLL_MINUTES),
    hint: sourceHint.optional(),
    private: sourcePrivate.default(false),
    config: gdriveSourceConfigSchema,
  }),
]);
export type SourceCreate = z.output<typeof sourceCreateSchema>;
export type SourceCreateInput = z.input<typeof sourceCreateSchema>;

/** Names the kind of the source, which never changes; a field left out keeps its value. */
export const sourcePatchSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('imap'),
    name: sourceName.optional(),
    enabled: z.boolean().optional(),
    poll_interval_minutes: pollInterval.optional(),
    hint: sourceHint.nullable().optional().describe('Null removes it.'),
    private: sourcePrivate.optional(),
    config: imapSourceConfigSchema.optional(),
    secret: keyUpdateSchema.describe('The password of the mailbox.'),
  }),
  z.strictObject({
    kind: z.literal('gdrive'),
    name: sourceName.optional(),
    enabled: z.boolean().optional(),
    poll_interval_minutes: pollInterval.optional(),
    hint: sourceHint.nullable().optional().describe('Null removes it.'),
    private: sourcePrivate.optional(),
    config: gdriveSourceConfigSchema.optional(),
  }),
]);
export type SourcePatch = z.output<typeof sourcePatchSchema>;
export type SourcePatchInput = z.input<typeof sourcePatchSchema>;

export const sourceCheckSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    items: z
      .array(z.strictObject({ name: z.string() }))
      .max(SOURCE_CHECK_SAMPLE)
      .describe('The first items the next run would take, oldest first: untrusted text.'),
  }),
  z.strictObject({ ok: z.literal(false), error: sourceErrorSchema }),
]);
export type SourceCheck = z.output<typeof sourceCheckSchema>;

export const sourceRunRequestSchema = z.strictObject({
  queued: z.boolean().describe('False when a run was already due at once.'),
});
export type SourceRunRequest = z.output<typeof sourceRunRequestSchema>;

/** Where to send the browser for the consent of Google; the answer comes back to Liasse. */
export const googleConsentSchema = z.strictObject({
  url: z.url().describe('The consent page of Google, for this source and this session only.'),
});
export type GoogleConsent = z.output<typeof googleConsentSchema>;
