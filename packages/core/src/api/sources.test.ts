import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { documentOrigins, ingestionSources } from '../db/schema/sources.ts';
import { documents } from '../db/schema/documents.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { buildSyntheticEmail } from '../testing/synthetic-email.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { createTestMailbox } from '../testing/test-mailbox.ts';
import {
  addSource,
  queuedPolls,
  sourcesContext,
  SYNTHETIC_IMAP_CONFIG,
} from '../sources/sources.test-helper.ts';
import { ApiError } from './errors.ts';
import {
  checkSource,
  createSource,
  deleteSource,
  getSource,
  listSources,
  requestSourceRun,
  updateSource,
} from './sources.ts';

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
};

describe('the source use cases', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  beforeEach(async () => {
    await database.db.delete(jobs);
    await database.db.delete(ingestionSources);
  });

  const context = () => sourcesContext(database.db);

  it('creates a source, never shows its secret, and queues its first run', async () => {
    const source = await createSource(context(), {
      kind: 'imap',
      name: 'Bills',
      enabled: true,
      poll_interval_minutes: 15,
      config: SYNTHETIC_IMAP_CONFIG,
      secret: { action: 'replace', value: 'synthetic-secret-91f2' },
    });
    expect(source).toMatchObject({
      kind: 'imap',
      name: 'Bills',
      secret: 'set',
      needs_attention: false,
      last_run: null,
      config: SYNTHETIC_IMAP_CONFIG,
    });
    expect(JSON.stringify(await listSources(context()))).not.toContain('synthetic-secret-91f2');
    const [row] = await database.db.select().from(ingestionSources);
    expect(row?.secret).not.toContain('synthetic-secret-91f2');
    expect(await queuedPolls(database.db)).toHaveLength(1);
  });

  it('binds a sealed secret to its source', async () => {
    const first = await addSource(database.db);
    const second = await addSource(database.db, { password: 'another' });
    const [sealed] = await database.db
      .select({ secret: ingestionSources.secret })
      .from(ingestionSources)
      .where(eq(ingestionSources.id, first));
    await database.db
      .update(ingestionSources)
      .set({ secret: sealed?.secret })
      .where(eq(ingestionSources.id, second));
    expect((await getSource(context(), second)).secret).toBe('unreadable');
    expect((await getSource(context(), first)).secret).toBe('set');
  });

  it('saves a source: keeps, clears, clears the flag and runs it again', async () => {
    const id = await addSource(database.db);
    await database.db
      .update(ingestionSources)
      .set({ needsAttention: true })
      .where(eq(ingestionSources.id, id));
    await database.db.delete(jobs);

    const renamed = await updateSource(context(), id, {
      kind: 'imap',
      name: 'Renamed',
      secret: { action: 'keep' },
    });
    expect(renamed).toMatchObject({ name: 'Renamed', secret: 'set', needs_attention: false });
    expect(await queuedPolls(database.db)).toHaveLength(1);

    const disabled = await updateSource(context(), id, {
      kind: 'imap',
      enabled: false,
      secret: { action: 'clear' },
    });
    expect(disabled).toMatchObject({ enabled: false, secret: 'unset', name: 'Renamed' });
    expect(await queuedPolls(database.db)).toEqual([]);
  });

  it('answers not found for an unknown source and refuses a run of a disabled one', async () => {
    expect(await codeOf(getSource(context(), 'src_unknown'))).toBe('source_not_found');
    expect(await codeOf(deleteSource(context(), 'src_unknown'))).toBe('source_not_found');
    const id = await addSource(database.db, { enabled: false });
    expect(await codeOf(requestSourceRun(context(), id))).toBe('source_disabled');
    await updateSource(context(), id, { kind: 'imap', enabled: true, secret: { action: 'keep' } });
    expect(await requestSourceRun(context(), id)).toEqual({ queued: false });
  });

  it('deletes a source and its queued runs; its documents stay', async () => {
    const id = await addSource(database.db);
    const document = await insertSyntheticDocument(database.db, { source: 'connector' });
    await database.db
      .insert(documentOrigins)
      .values({ documentId: document.id, sourceId: id, externalId: 'INBOX:1:1', name: 'a.eml' });

    await deleteSource(context(), id);

    expect(await database.db.$count(documentOrigins)).toBe(0);
    expect(await database.db.$count(documents, eq(documents.id, document.id))).toBe(1);
    expect(await queuedPolls(database.db)).toEqual([]);
  });

  it('checks a source against its server without moving its cursor', async () => {
    const mailbox = await createTestMailbox();
    try {
      await mailbox.append(
        buildSyntheticEmail({
          label: 'checked',
          attachments: [{ filename: 'a.pdf', mime: 'application/pdf', bytes: syntheticPdf('a') }],
        }),
        { date: new Date('2026-03-01T12:00:00Z') },
      );
      const id = await addSource(database.db, {
        config: mailbox.config,
        password: mailbox.password,
      });
      expect(await checkSource(context(), id)).toEqual({
        ok: true,
        items: [{ name: 'checked.eml' }],
      });
      expect((await getSource(context(), id)).last_run).toBeNull();
      const [row] = await database.db.select().from(ingestionSources);
      expect(row?.cursor).toBeNull();

      const wrong = await addSource(database.db, { config: mailbox.config, password: 'wrong' });
      expect(await checkSource(context(), wrong)).toMatchObject({
        ok: false,
        error: { kind: 'credentials' },
      });
    } finally {
      await mailbox.dispose();
    }
  });
});
