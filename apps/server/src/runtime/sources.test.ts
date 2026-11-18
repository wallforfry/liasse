import { sourceCheckSchema, sourceListSchema, sourceSchema } from '@liasse/contract';
import { documentOrigins, documents, ingestionSources, jobs } from '@liasse/core/db';
import {
  buildSyntheticEmail,
  createTestMailbox,
  syntheticPdf,
  type TestMailbox,
  waitUntil,
} from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Runtime } from './create-runtime.ts';
import { useRuntimeHarness } from './runtime.test-helper.ts';

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const withPdf = (label: string) =>
  buildSyntheticEmail({
    label,
    attachments: [
      { filename: `${label}.pdf`, mime: 'application/pdf', bytes: syntheticPdf(label) },
    ],
  });

describe('the ingestion sources of a running server', () => {
  const harness = useRuntimeHarness();
  const { callAsPerson } = harness;
  let mailbox: TestMailbox;

  beforeEach(async () => {
    mailbox = await createTestMailbox();
  });

  afterEach(async () => {
    await mailbox.dispose();
  });

  const create = async (runtime: Runtime, password = mailbox.password) => {
    const response = await callAsPerson(
      runtime,
      '/sources',
      json('POST', {
        kind: 'imap',
        name: 'Synthetic mailbox',
        config: mailbox.config,
        secret: { action: 'replace', value: password },
      }),
    );
    expect(response.status).toBe(201);
    return sourceSchema.parse(await response.json());
  };

  it('ingests the messages of a mailbox created in the web UI', async () => {
    await mailbox.append(withPdf('statement'), { date: new Date('2026-03-01T12:00:00Z') });
    const runtime = await harness.start();
    const source = await create(runtime);
    expect(source.secret).toBe('set');
    expect(JSON.stringify(source)).not.toContain(mailbox.password);

    const db = harness.database().db;
    // The email and its attachment, which the pipeline ingests from it.
    await waitUntil(async () => (await db.$count(documents)) === 2);
    const [origin] = await db.select().from(documentOrigins);
    const [email] = await db
      .select({ name: documents.originalName, source: documents.source })
      .from(documents)
      .where(eq(documents.id, origin?.documentId ?? ''));
    expect(email).toEqual({ name: 'statement.eml', source: 'connector' });
    await waitUntil(async () => {
      const listing = sourceListSchema.parse(
        await (await callAsPerson(runtime, '/sources')).json(),
      );
      return listing.sources[0]?.last_run?.ingested === 1;
    });

    const check = await callAsPerson(runtime, `/sources/${source.id}/check`, { method: 'POST' });
    expect(sourceCheckSchema.parse(await check.json())).toEqual({ ok: true, items: [] });
    const run = await callAsPerson(runtime, `/sources/${source.id}/run`, { method: 'POST' });
    expect(run.status).toBe(202);
  });

  it('flags a source whose password is refused, and a save clears the flag', async () => {
    const runtime = await harness.start();
    const source = await create(runtime, 'wrong-password');
    const read = async () =>
      sourceSchema.parse(await (await callAsPerson(runtime, `/sources/${source.id}`)).json());
    await waitUntil(async () => (await read()).needs_attention);
    expect((await read()).last_run?.error?.kind).toBe('credentials');
    const refused = await callAsPerson(runtime, `/sources/${source.id}/run`, { method: 'POST' });
    expect(refused.status).toBe(409);

    const saved = await callAsPerson(
      runtime,
      `/sources/${source.id}`,
      json('PATCH', { kind: 'imap', secret: { action: 'replace', value: mailbox.password } }),
    );
    expect(sourceSchema.parse(await saved.json()).needs_attention).toBe(false);
    await waitUntil(async () => (await read()).last_run?.error === null);
  });

  it('answers the sources to a session only, never to an API key', async () => {
    const runtime = await harness.start();
    expect((await harness.call(runtime, '/sources')).status).toBe(401);
    const created = await harness.call(
      runtime,
      '/sources',
      json('POST', { kind: 'imap', name: 'x', config: mailbox.config }),
    );
    expect(created.status).toBe(401);
    expect(await harness.database().db.$count(ingestionSources)).toBe(0);
  });

  it('queues a run of every enabled source at startup', async () => {
    const runtime = await harness.start();
    const source = await create(runtime);
    await waitUntil(async () => (await read(runtime, source.id)).last_run !== null);
    await runtime.stop();
    const db = harness.database().db;
    await db.delete(jobs).where(eq(jobs.kind, 'source_poll'));

    await harness.start();

    const queued = await db.select().from(jobs).where(eq(jobs.kind, 'source_poll'));
    expect(queued.map(({ payload }) => payload)).toContainEqual({ sourceId: source.id });
  });

  const read = async (runtime: Runtime, id: string) =>
    sourceSchema.parse(await (await callAsPerson(runtime, `/sources/${id}`)).json());
});
