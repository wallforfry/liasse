import { z } from 'zod';
import type { JsonObject } from '../../db/columns.ts';

const mailboxCursorSchema = z.object({
  // A bigint on the wire: kept as its decimal text.
  uid_validity: z.string().regex(/^\d+$/),
  last_uid: z.int().min(0),
});

/** Per mailbox, the `UIDVALIDITY` the UIDs belong to and the last UID handled. */
export const imapCursorSchema = z.object({
  mailboxes: z.record(z.string(), mailboxCursorSchema),
});
export type ImapCursor = z.output<typeof imapCursorSchema>;

const EMPTY: ImapCursor = { mailboxes: {} };

/** The stored cursor, or an empty one, which starts every mailbox from the start date. */
export const parseImapCursor = (cursor: JsonObject | null): ImapCursor => {
  const parsed = imapCursorSchema.safeParse(cursor);
  return parsed.success ? parsed.data : EMPTY;
};

export const advanceMailbox = (
  cursor: ImapCursor,
  mailbox: string,
  uidValidity: string,
  lastUid: number,
): ImapCursor => ({
  mailboxes: { ...cursor.mailboxes, [mailbox]: { uid_validity: uidValidity, last_uid: lastUid } },
});
