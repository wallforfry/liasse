import { documents, jobs, typeChanges } from '@liasse/core/db';
import { waitUntil } from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LETTER, NEW_CONTRACT, OLD_CONTRACT } from '../synthetic-documents.fixture.ts';
import type { Runtime } from './create-runtime.ts';
import { useRuntimeHarness, withoutHandlers } from './runtime.test-helper.ts';

const SETTLED: readonly string[] = ['indexed', 'needs_review'];

const datesSchema = z.object({
  dates: z.array(z.object({ date: z.string(), kind: z.string(), document: z.object({}) })),
});

describe('the features the runtime binds', () => {
  const harness = useRuntimeHarness();
  const { start, call, upload, documentOf, jobsOf } = harness;

  const correct = (runtime: Runtime, id: string, correction: Readonly<Record<string, unknown>>) =>
    call(runtime, `/documents/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(correction),
    });

  const linksDetected = async (id: string): Promise<boolean> =>
    (await jobsOf('detect_links', id)).some(({ status }) => status === 'succeeded');

  const datesOf = async (runtime: Runtime, query: string) =>
    datesSchema
      .parse(await (await call(runtime, `/upcoming?from=2027-01-01&to=2027-12-31${query}`)).json())
      .dates.map(({ date, kind }) => `${date} ${kind}`);

  it('takes an uploaded document to indexed, with its knowledge, and answers about it', async () => {
    const runtime = await start();
    const id = await upload(runtime, LETTER.lines, 'letter.pdf');
    await waitUntil(async () => (await documentOf(id))?.status === 'indexed');

    const subjects = await call(runtime, '/subjects?kind=contract');
    expect(subjects.status).toBe(200);
    expect(await subjects.json()).toMatchObject({
      subjects: [{ kind: 'contract', name: 'Home insurance contract', documentCount: 1 }],
      truncated: false,
    });
    expect(await datesOf(runtime, '')).toEqual(['2027-03-15 due']);

    const corrected = await correct(runtime, id, { private: true });
    expect(corrected.status).toBe(200);
    expect(await corrected.json()).toMatchObject({ id, private: true, status: 'indexed' });
    expect(await documentOf(id)).toEqual({ status: 'indexed', private: true });
    expect(await datesOf(runtime, '')).toEqual([]);
  });

  it('detects links once a document is indexed: a superseded contract has no date to come', async () => {
    const runtime = await start();
    const old = await upload(runtime, OLD_CONTRACT.lines, 'old.pdf');
    await waitUntil(() => linksDetected(old));
    expect(await datesOf(runtime, '')).toEqual(['2027-01-25 renewal']);

    const replacement = await upload(runtime, NEW_CONTRACT.lines, 'new.pdf');
    await waitUntil(() => linksDetected(replacement));
    expect(SETTLED).toContain((await documentOf(replacement))?.status);
    expect(await datesOf(runtime, '')).toEqual(['2027-06-20 renewal']);
    expect(await datesOf(runtime, '&current_only=false')).toEqual([
      '2027-01-25 renewal',
      '2027-06-20 renewal',
    ]);
  });

  it('lists and decides consolidation changes, and keeps a nightly run queued', async () => {
    const runtime = await start();
    const nightly = await harness
      .database()
      .db.select({ payload: jobs.payload, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.kind, 'consolidate'));
    expect(nightly).toEqual([{ payload: { trigger: 'nightly' }, status: 'queued' }]);

    const id = await upload(runtime, LETTER.lines, 'letter.pdf');
    await waitUntil(async () => (await documentOf(id))?.status === 'indexed');
    const [document] = await harness
      .database()
      .db.select({ typeId: documents.typeId })
      .from(documents)
      .where(eq(documents.id, id));
    const [change] = await harness
      .database()
      .db.insert(typeChanges)
      .values({
        kind: 'stabilize',
        payload: { type_id: document?.typeId ?? '' },
        rationale: 'Synthetic rationale.',
      })
      .returning({ id: typeChanges.id });

    const listed = await call(runtime, '/changes?kind=stabilize');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      changes: [{ id: change?.id, kind: 'stabilize', status: 'pending' }],
      truncated: false,
    });
    const decide = () =>
      call(runtime, `/changes/${change?.id ?? ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'apply', note: 'Looks right.' }),
      });
    const applied = await decide();
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      change: { status: 'applied', note: 'Looks right.' },
      documents_to_reextract: 0,
    });
    const again = await decide();
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: { code: 'change_already_decided' } });
    expect(await (await call(runtime, '/changes')).json()).toEqual({
      changes: [],
      truncated: false,
    });
  });

  it('fails at startup a document on its way that no job will process', async () => {
    const first = await start({}, { bind: withoutHandlers('process_document') });
    const id = await upload(first, LETTER.lines, 'abandoned.pdf');
    await first.stop();
    await harness.database().db.delete(jobs);

    await start({}, { bind: withoutHandlers('process_document') });
    expect(await documentOf(id)).toEqual({ status: 'failed', private: false });
  });

  it('queues a Hindsight sync once a document is indexed, and with a flip of its private flag', async () => {
    // Without these handlers the syncs stay queued to be counted, and only the
    // correction itself can queue one after the indexing.
    const runtime = await start(
      { HINDSIGHT_URL: 'http://127.0.0.1:9' },
      { bind: withoutHandlers('hindsight_sync', 'reindex_document') },
    );
    const id = await upload(runtime, LETTER.lines, 'followed.pdf');
    const syncs = async () => (await jobsOf('hindsight_sync', id)).length;
    await waitUntil(async () => (await syncs()) === 1);
    expect(await documentOf(id)).toEqual({ status: 'indexed', private: false });

    expect((await correct(runtime, id, { private: true })).status).toBe(200);
    expect(await syncs()).toBe(2);
    expect((await correct(runtime, id, { private: true })).status).toBe(200);
    expect(await syncs()).toBe(2);
  });
});
