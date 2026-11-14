import { jobs } from '@liasse/core/db';
import { waitUntil } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LETTER, NEW_CONTRACT, OLD_CONTRACT } from '../synthetic-documents.fixture.ts';
import type { Runtime } from './create-runtime.ts';
import { useRuntimeHarness, withoutHandlers } from './runtime.test-helper.ts';

const SETTLED: readonly string[] = ['indexed', 'needs_review'];

const datesSchema = z.object({
  dates: z.array(z.object({ date: z.string(), kind: z.string(), document: z.object({}) })),
});

const toolResponse = z.object({
  result: z.object({
    isError: z.boolean().optional(),
    content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]),
  }),
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

  // One stateless JSON-RPC call of a tool; its answer is the JSON of its one text content.
  const callTool = async (
    runtime: Runtime,
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> => {
    const response = await call(runtime, '/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const { result } = toolResponse.parse(await response.json());
    expect(result.isError).toBeUndefined();
    const body: unknown = JSON.parse(result.content[0].text);
    return body;
  };

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
    expect((await call(runtime, '/changes')).status).toBe(501);
  });

  it('answers the knowledge tools of MCP from what the pipeline stored', async () => {
    const runtime = await start();
    const id = await upload(runtime, LETTER.lines, 'letter.pdf');
    await waitUntil(async () => (await documentOf(id))?.status === 'indexed');

    const subject = z
      .object({ found: z.literal(true), subject: z.object({ id: z.string() }) })
      .parse(await callTool(runtime, 'get_subject', { query: 'Home insurance contract' }));
    expect(await callTool(runtime, 'timeline', { subject: subject.subject.id })).toMatchObject({
      items: [{ kind: 'document', document: { id } }],
    });
    expect(await callTool(runtime, 'recall', { query: 'next review' })).toMatchObject({
      facts: [{ text: 'The next review is due on 15/03/2027.', documentId: id }],
    });
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
