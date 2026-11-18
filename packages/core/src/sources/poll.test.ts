import { sourceRunSchema } from '@liasse/contract';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { documentOrigins, ingestionSources } from '../db/schema/sources.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createIngestHarness, type IngestHarness } from '../ingest/harness.test-helper.ts';
import { createGate } from '../testing/async.ts';
import { buildSyntheticEmail } from '../testing/synthetic-email.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { createTestMailbox, type TestMailbox } from '../testing/test-mailbox.ts';
import { type SourceConnectors, SourceCredentialsError } from './connector.ts';
import { pollSource, type SourcePollDeps } from './poll.ts';
import {
  addSource,
  fakeConnectors,
  queuedPolls,
  setCursor,
  storedSource,
  TEST_SECRETS,
  testConnectors,
} from './sources.test-helper.ts';

const withPdf = (label: string, bytes: Uint8Array = syntheticPdf(label)) =>
  buildSyntheticEmail({
    label,
    attachments: [{ filename: `${label}.pdf`, mime: 'application/pdf', bytes }],
  });

const SINCE_START = new Date('2026-03-01T12:00:00Z');

describe('a run of a source', () => {
  let harness: IngestHarness;
  let mailbox: TestMailbox;

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  beforeEach(async () => {
    await harness.reset();
    await harness.database.db.delete(ingestionSources);
    mailbox = await createTestMailbox();
  });

  afterEach(async () => {
    await mailbox.dispose();
  });

  const depsWith = (
    connectors: SourceConnectors = testConnectors(harness.database.db).connectors,
  ): SourcePollDeps => ({
    ...harness.deps,
    secrets: TEST_SECRETS,
    connectors,
  });

  const poll = (id: string, connectors?: SourceConnectors) =>
    pollSource(depsWith(connectors), id, new AbortController().signal);

  const lastRunOf = async (id: string) => {
    const { lastRun } = await storedSource(harness.database.db, id);
    return sourceRunSchema.parse(lastRun);
  };

  const mailboxSource = () =>
    addSource(harness.database.db, { config: mailbox.config, password: mailbox.password });

  it('ingests each message as an email document of the connector, with its origin', async () => {
    const uid = await mailbox.append(withPdf('invoice'), { date: SINCE_START });
    const id = await mailboxSource();

    await poll(id);

    const db = harness.database.db;
    const [document] = await db.select().from(documents);
    expect(document).toMatchObject({
      source: 'connector',
      mime: 'message/rfc822',
      originalName: 'invoice.eml',
    });
    const [origin] = await db.select().from(documentOrigins);
    expect(origin).toMatchObject({ documentId: document?.id, sourceId: id, name: 'invoice.eml' });
    expect(origin?.externalId).toMatch(new RegExp(`^INBOX:\\d+:${String(uid)}$`));
    expect(await lastRunOf(id)).toMatchObject({
      ingested: 1,
      duplicates: 0,
      skipped: 0,
      error: null,
    });
    expect((await storedSource(db, id)).cursor).toMatchObject({
      mailboxes: { INBOX: { last_uid: uid } },
    });
  });

  it('queues its next run after the interval, once', async () => {
    const id = await mailboxSource();
    const db = harness.database.db;
    await db.delete(jobs);
    const before = Date.now();

    await poll(id);
    await poll(id);

    const queued = await queuedPolls(db);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.runAfter.getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000);
  });

  it('takes nothing again on the next run', async () => {
    await mailbox.append(withPdf('once'), { date: SINCE_START });
    const id = await mailboxSource();
    await poll(id);
    await poll(id);
    expect(await harness.database.db.$count(documents)).toBe(1);
    expect(await lastRunOf(id)).toMatchObject({ ingested: 0, duplicates: 0 });
  });

  it('never revives a deleted document, and records no origin for it', async () => {
    await mailbox.append(withPdf('deleted'), { date: SINCE_START });
    const id = await mailboxSource();
    const db = harness.database.db;
    await poll(id);
    const [document] = await db.select({ id: documents.id }).from(documents);
    if (document === undefined) throw new Error('No document');
    expect(await deleteDocument({ db }, document.id)).toBe(true);

    await setCursor(db, id, null);
    await poll(id);

    const [after] = await db.select({ status: documents.status }).from(documents);
    expect(after?.status).toBe('deleted');
    expect(await db.$count(documentOrigins)).toBe(0);
    expect(await lastRunOf(id)).toMatchObject({ ingested: 0, duplicates: 1 });
  });

  it('skips a message over the size limit for good and goes on with the next', async () => {
    const large = Uint8Array.from(Buffer.concat([syntheticPdf('large'), Buffer.alloc(70_000, 65)]));
    const skipped = await mailbox.append(withPdf('large', large), { date: SINCE_START });
    await mailbox.append(withPdf('small'), { date: SINCE_START });
    const id = await mailboxSource();

    await poll(id);

    const run = await lastRunOf(id);
    expect(run).toMatchObject({ ingested: 1, skipped: 1 });
    expect(run.skipped_items).toHaveLength(1);
    const [item] = run.skipped_items;
    expect(item?.external_id).toMatch(new RegExp(`:${String(skipped)}$`));
    expect(item?.name).toBe('large.eml');
    expect(item?.reason).toContain('larger than the limit');
    await poll(id);
    expect(await lastRunOf(id)).toMatchObject({ ingested: 0, skipped: 0 });
  });

  it('gives every document of the source its hint and its private flag', async () => {
    await mailbox.append(withPdf('flagged'), { date: SINCE_START });
    const db = harness.database.db;
    const id = await addSource(db, {
      config: mailbox.config,
      password: mailbox.password,
      hint: 'Bank statements',
      private: true,
    });
    await poll(id);
    const [document] = await db.select().from(documents);
    expect(document).toMatchObject({ hint: 'Bank statements', private: true });
  });

  it('skips an item the source says is too large without downloading it', async () => {
    const id = await mailboxSource();
    let opened = 0;
    const connectors = fakeConnectors([
      {
        cursor: { at: 1 },
        item: {
          externalId: 'huge',
          name: 'huge.eml',
          size: harness.deps.maxFileSize + 1,
          open: () => {
            opened += 1;
            return Promise.resolve(ReadableStream.from([syntheticPdf('huge')]));
          },
        },
      },
    ]);
    await poll(id, connectors);
    expect(opened).toBe(0);
    expect(await lastRunOf(id)).toMatchObject({ skipped: 1, ingested: 0 });
    expect((await storedSource(harness.database.db, id)).cursor).toEqual({ at: 1 });
  });

  it('leaves the flag of refused credentials to a run that read the source as last saved', async () => {
    const db = harness.database.db;
    const id = await mailboxSource();
    const refused = fakeConnectors([], async () => {
      // A person saves the source while the run is connecting with what it read before.
      await db
        .update(ingestionSources)
        .set({ updatedAt: new Date(Date.now() + 1000) })
        .where(eq(ingestionSources.id, id));
      throw new SourceCredentialsError('Refused');
    });
    await poll(id, refused);
    expect((await storedSource(db, id)).needsAttention).toBe(false);
  });

  it('stops polling a source whose credentials are refused, until a person saves it', async () => {
    const db = harness.database.db;
    const id = await addSource(db, { config: mailbox.config, password: 'wrong-password' });

    await poll(id);

    const source = await storedSource(db, id);
    expect(source).toMatchObject({ enabled: true, needsAttention: true });
    expect((await lastRunOf(id)).error?.kind).toBe('credentials');
    expect(await queuedPolls(db)).toEqual([]);
    await poll(id);
    expect((await storedSource(db, id)).lastRun).toEqual(source.lastRun);
  });

  it('keeps the cursor of the item a transient failure stopped at, and fails the job', async () => {
    const db = harness.database.db;
    const id = await mailboxSource();
    await setCursor(db, id, { at: 0 });
    const connectors = fakeConnectors([
      {
        cursor: { at: 1 },
        item: {
          externalId: 'one',
          name: 'one.pdf',
          open: () => Promise.resolve(ReadableStream.from([syntheticPdf('one')])),
        },
      },
      {
        cursor: { at: 2 },
        item: {
          externalId: 'two',
          name: 'two.pdf',
          open: () => Promise.reject(new Error('The connection was reset')),
        },
      },
    ]);

    await expect(poll(id, connectors)).rejects.toThrow('The connection was reset');

    expect((await storedSource(db, id)).cursor).toEqual({ at: 1 });
    expect(await lastRunOf(id)).toMatchObject({
      ingested: 1,
      error: { kind: 'transient', message: 'The connection was reset' },
    });
    expect((await storedSource(db, id)).needsAttention).toBe(false);
  });

  it('runs one source once at a time: a second run returns at once', async () => {
    const db = harness.database.db;
    const id = await mailboxSource();
    const entered = createGate();
    const release = createGate();
    let connections = 0;
    const connectors = fakeConnectors([{ cursor: { done: true } }], async () => {
      connections += 1;
      entered.open();
      await release.opened;
    });

    const first = poll(id, connectors);
    await entered.opened;
    await poll(id, connectors);
    release.open();
    await first;

    expect(connections).toBe(1);
    expect((await storedSource(db, id)).cursor).toEqual({ done: true });
  });

  it('does not run a disabled source', async () => {
    await mailbox.append(withPdf('disabled'), { date: SINCE_START });
    const db = harness.database.db;
    const id = await addSource(db, {
      config: mailbox.config,
      password: mailbox.password,
      enabled: false,
    });
    await poll(id);
    expect(await db.$count(documents)).toBe(0);
    expect((await storedSource(db, id)).lastRun).toBeNull();
    expect(await db.$count(ingestionSources, eq(ingestionSources.id, id))).toBe(1);
  });
});
