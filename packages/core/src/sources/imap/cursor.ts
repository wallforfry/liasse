import { z } from 'zod';
import type { JsonObject } from '../../db/columns.ts';

const mailboxCursorSchema = z.object({
  // A bigint on the wire: kept as its decimal text.
  uid_validity: z.string().regex(/^\d+$/),
  last_uid: z.int().min(0),
  // False until a run read the mailbox to its end once: until then, the search keeps the
  // start date, so a first pass cut short does not resume on older mail with higher UIDs.
  caught_up: z.boolean(),
});

/**
 * Per mailbox, the `UIDVALIDITY` the UIDs belong to, the last UID handled, and whether the
 * first pass from the start date is over.
 */
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
  position: { readonly uidValidity: string; readonly lastUid: number; readonly caughtUp: boolean },
): ImapCursor => ({
  mailboxes: {
    ...cursor.mailboxes,
    [mailbox]: {
      uid_validity: position.uidValidity,
      last_uid: position.lastUid,
      caught_up: position.caughtUp,
    },
  },
});
