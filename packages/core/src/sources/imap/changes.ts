import type { ImapSourceConfig } from '@liasse/contract';
import type { FetchMessageObject, ImapFlow, SearchObject } from 'imapflow';
import { type SourceChange, type SourceItem, SourceItemError } from '../connector.ts';
import { advanceMailbox, type ImapCursor } from './cursor.ts';
import { hasAttachment } from './structure.ts';

// BODYSTRUCTURE of this many messages per FETCH: a first run may list years of mail.
const FETCH_BATCH = 100;
const MAX_SUBJECT_LENGTH = 200;
const FALLBACK_NAME = 'message';

const batchesOf = (uids: readonly number[]): readonly (readonly number[])[] =>
  Array.from({ length: Math.ceil(uids.length / FETCH_BATCH) }, (_, index) =>
    uids.slice(index * FETCH_BATCH, (index + 1) * FETCH_BATCH),
  );

// Until a first pass read the mailbox to its end, the search keeps the start date; after
// it, the UIDs after the last handled, whatever their date, so a Gmail label put on an old
// message later still brings it. A mailbox whose UIDs were renumbered starts over.
const searchUids = async (
  client: ImapFlow,
  config: ImapSourceConfig,
  lastUid: number | undefined,
  caughtUp: boolean,
): Promise<readonly number[]> => {
  const query: SearchObject = {
    ...(caughtUp ? {} : { since: new Date(`${config.start_date}T00:00:00Z`) }),
    ...(lastUid === undefined ? {} : { uid: `${String(lastUid + 1)}:*` }),
    ...(config.from === undefined ? {} : { from: config.from }),
    ...(config.subject === undefined ? {} : { subject: config.subject }),
  };
  const uids = await client.search(query, { uid: true });
  if (uids === false || uids === undefined) throw new Error('The server refused the search');
  // `n:*` always names the last message, even when its UID is below n.
  return uids.filter((uid) => lastUid === undefined || uid > lastUid).toSorted((a, b) => a - b);
};

// The fetch is read to its end before anything else is sent: IMAP answers one command at a
// time, and an item is downloaded between two batches.
const fetchSummaries = async (
  client: ImapFlow,
  uids: readonly number[],
): Promise<readonly FetchMessageObject[]> => {
  const messages: FetchMessageObject[] = [];
  for await (const message of client.fetch(
    uids.join(','),
    { uid: true, size: true, bodyStructure: true, envelope: true },
    { uid: true },
  )) {
    messages.push(message);
  }
  return messages.toSorted((a, b) => a.uid - b.uid);
};

const nameOf = (message: FetchMessageObject): string => {
  const subject = (message.envelope?.subject ?? '')
    .replace(/[/\\]/g, '-')
    .trim()
    .slice(0, MAX_SUBJECT_LENGTH);
  return `${subject === '' ? FALLBACK_NAME : subject}.eml`;
};

const itemOf = (
  client: ImapFlow,
  mailbox: string,
  uidValidity: string,
  message: FetchMessageObject,
): SourceItem => ({
  externalId: `${mailbox}:${uidValidity}:${String(message.uid)}`,
  name: nameOf(message),
  size: message.size,
  // The raw message, as the server stores it: its hash is the same in every folder.
  open: async () => {
    const download = await client.download(String(message.uid), undefined, { uid: true });
    if (download.content === undefined) {
      throw new SourceItemError('The message left the mailbox before it was read');
    }
    return download.content;
  },
});

/**
 * The messages of each mailbox after the cursor, oldest first, opened read-only (`EXAMINE`:
 * no flag is set, `\Seen` included). A message without an attachment moves the cursor but
 * is not an item, unless the source takes them all.
 */
export async function* imapChanges(
  client: ImapFlow,
  config: ImapSourceConfig,
  start: ImapCursor,
): AsyncGenerator<SourceChange> {
  let cursor = start;
  for (const path of config.mailboxes) {
    const mailbox = await client.mailboxOpen(path, { readOnly: true });
    const uidValidity = mailbox.uidValidity.toString();
    const known = cursor.mailboxes[path];
    const resumed = known?.uid_validity === uidValidity ? known : undefined;
    const lastUid = resumed?.last_uid;
    const caughtUp = resumed?.caught_up === true;
    const uids = await searchUids(client, config, lastUid, caughtUp);
    for (const batch of batchesOf(uids)) {
      for (const message of await fetchSummaries(client, batch)) {
        cursor = advanceMailbox(cursor, path, { uidValidity, lastUid: message.uid, caughtUp });
        if (config.include_messages_without_attachments || hasAttachment(message.bodyStructure)) {
          yield { cursor, item: itemOf(client, path, uidValidity, message) };
        }
      }
    }
    // Every UID below `uidNext` existed when the search ran: those it left out (older than
    // the start date, or not matching the filters) are never wanted. A server may omit it.
    const below = Number.isSafeInteger(mailbox.uidNext) ? mailbox.uidNext - 1 : 0;
    const handled = Math.max(lastUid ?? 0, uids.at(-1) ?? 0, below);
    cursor = advanceMailbox(cursor, path, { uidValidity, lastUid: handled, caughtUp: true });
    yield { cursor };
  }
}
