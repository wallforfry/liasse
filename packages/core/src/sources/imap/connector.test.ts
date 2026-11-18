import type { ImapSourceConfig } from '@liasse/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject } from '../../db/columns.ts';
import { buildSyntheticEmail } from '../../testing/synthetic-email.ts';
import { syntheticPdf, syntheticPng } from '../../testing/synthetic-files.ts';
import { createTestMailbox, type TestMailbox } from '../../testing/test-mailbox.ts';
import { type SourceChange, SourceCredentialsError } from '../connector.ts';
import { imapConnector } from './connector.ts';
import { imapCursorSchema } from './cursor.ts';

const withPdf = (label: string, from?: string) =>
  buildSyntheticEmail({
    label,
    ...(from === undefined ? {} : { from }),
    attachments: [
      { filename: `${label}.pdf`, mime: 'application/pdf', bytes: syntheticPdf(label) },
    ],
  });

const READ_SINCE = new Date('2026-03-01T12:00:00Z');
const BEFORE_START = new Date('2025-06-01T12:00:00Z');

const changesOf = async (
  config: ImapSourceConfig,
  password: string,
  cursor: JsonObject | null = null,
): Promise<readonly SourceChange[]> => {
  const session = await imapConnector.connect(config, password, new AbortController().signal);
  try {
    const changes: SourceChange[] = [];
    for await (const change of session.changes(cursor)) changes.push(change);
    return changes;
  } finally {
    await session.close();
  }
};

const namesOf = (changes: readonly SourceChange[]) =>
  changes.flatMap(({ item }) => (item === undefined ? [] : [item.name]));

const lastCursor = (changes: readonly SourceChange[]) => {
  const last = changes.at(-1);
  if (last === undefined) throw new Error('No change');
  return last.cursor;
};

const readAll = async (stream: AsyncIterable<Uint8Array>): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

describe('the IMAP connector', () => {
  let mailbox: TestMailbox;

  beforeEach(async () => {
    mailbox = await createTestMailbox('2026-01-01');
  });

  afterEach(async () => {
    await mailbox.dispose();
  });

  it('takes the messages with an attachment from the start date, oldest first', async () => {
    await mailbox.append(withPdf('before-start'), { date: BEFORE_START });
    const kept = await mailbox.append(withPdf('kept'), { date: READ_SINCE });
    await mailbox.append(buildSyntheticEmail({ label: 'no-attachment' }), { date: READ_SINCE });
    const inlineOnly = buildSyntheticEmail({
      label: 'inline-only',
      attachments: [
        { filename: 'logo.png', mime: 'image/png', bytes: syntheticPng('logo'), inline: true },
      ],
    });
    const last = await mailbox.append(inlineOnly, { date: READ_SINCE });

    const changes = await changesOf(mailbox.config, mailbox.password);

    expect(namesOf(changes)).toEqual(['kept.eml']);
    const item = changes.find((change) => change.item !== undefined)?.item;
    expect(item?.externalId).toMatch(new RegExp(`^INBOX:\\d+:${String(kept)}$`));
    // The cursor goes past the messages it left out, the last one included.
    expect(imapCursorSchema.parse(lastCursor(changes)).mailboxes.INBOX?.last_uid).toBe(last);
  });

  it('opens the raw message, and the next run starts after the cursor whatever the date', async () => {
    await mailbox.append(withPdf('first'), { date: READ_SINCE });
    const session = await imapConnector.connect(
      mailbox.config,
      mailbox.password,
      new AbortController().signal,
    );
    let cursor: JsonObject | null = null;
    try {
      for await (const change of session.changes(null)) {
        if (change.item !== undefined) {
          const raw = await readAll(await change.item.open());
          expect(raw).toContain('Subject: first');
          expect(raw).toContain('Body of first.');
        }
        cursor = change.cursor;
      }
    } finally {
      await session.close();
    }

    // A Gmail label put on an old message brings it with a new UID and its old date.
    await mailbox.append(withPdf('labelled-later'), { date: BEFORE_START });
    const next = await changesOf(mailbox.config, mailbox.password, cursor);
    expect(namesOf(next)).toEqual(['labelled-later.eml']);
    expect(namesOf(await changesOf(mailbox.config, mailbox.password, lastCursor(next)))).toEqual(
      [],
    );
  });

  it('restarts from the start date when the UIDVALIDITY of a mailbox changed', async () => {
    await mailbox.append(withPdf('before-start'), { date: BEFORE_START });
    await mailbox.append(withPdf('since-start'), { date: READ_SINCE });
    const first = await changesOf(mailbox.config, mailbox.password);
    const { mailboxes } = imapCursorSchema.parse(lastCursor(first));
    const renumbered = {
      mailboxes: { INBOX: { uid_validity: '1', last_uid: mailboxes.INBOX?.last_uid ?? 0 } },
    };

    const again = await changesOf(mailbox.config, mailbox.password, renumbered);

    expect(namesOf(again)).toEqual(['since-start.eml']);
  });

  it('takes the messages without an attachment when the source asks for them', async () => {
    await mailbox.append(buildSyntheticEmail({ label: 'plain' }), { date: READ_SINCE });
    const changes = await changesOf(
      { ...mailbox.config, include_messages_without_attachments: true },
      mailbox.password,
    );
    expect(namesOf(changes)).toEqual(['plain.eml']);
  });

  it('filters on the sender and the subject', async () => {
    await mailbox.append(withPdf('invoice-1', 'Billing <billing@example.com>'), {
      date: READ_SINCE,
    });
    await mailbox.append(withPdf('invoice-2', 'Other <other@example.com>'), { date: READ_SINCE });
    await mailbox.append(withPdf('receipt-3', 'Billing <billing@example.com>'), {
      date: READ_SINCE,
    });
    const changes = await changesOf(
      { ...mailbox.config, from: 'billing@example.com', subject: 'invoice' },
      mailbox.password,
    );
    expect(namesOf(changes)).toEqual(['invoice-1.eml']);
  });

  it('reads each mailbox with a cursor of its own', async () => {
    await mailbox.append(withPdf('in-inbox'), { date: READ_SINCE });
    await mailbox.append(withPdf('in-invoices'), { mailbox: 'Invoices', date: READ_SINCE });
    const config = { ...mailbox.config, mailboxes: ['INBOX', 'Invoices'] };
    const changes = await changesOf(config, mailbox.password);
    expect(namesOf(changes)).toEqual(['in-inbox.eml', 'in-invoices.eml']);
    expect(Object.keys(imapCursorSchema.parse(lastCursor(changes)).mailboxes)).toEqual([
      'INBOX',
      'Invoices',
    ]);
  });

  // A session that selects a mailbox read-write takes the `\Recent` flag of its messages;
  // one that examines it leaves it, as it leaves `\Seen`.
  it('reads a mailbox read-only and never marks a message as seen', async () => {
    const uid = await mailbox.append(withPdf('unread'), { date: READ_SINCE });
    const session = await imapConnector.connect(
      mailbox.config,
      mailbox.password,
      new AbortController().signal,
    );
    try {
      for await (const { item } of session.changes(null)) {
        if (item !== undefined) await readAll(await item.open());
      }
    } finally {
      await session.close();
    }
    const flags = await mailbox.withClient(async (client) => {
      await client.mailboxOpen('INBOX', { readOnly: true });
      const message = await client.fetchOne(String(uid), { flags: true }, { uid: true });
      return message === false ? undefined : message.flags;
    });
    expect(flags).toBeDefined();
    expect([...(flags ?? [])]).toEqual(['\\Recent']);
  });

  it('refuses a wrong or a missing password as a credential error', async () => {
    const signal = new AbortController().signal;
    await expect(imapConnector.connect(mailbox.config, 'wrong', signal)).rejects.toBeInstanceOf(
      SourceCredentialsError,
    );
    await expect(imapConnector.connect(mailbox.config, undefined, signal)).rejects.toBeInstanceOf(
      SourceCredentialsError,
    );
  });
});
