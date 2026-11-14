import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { waitUntil } from '../testing/async.ts';
import { syntheticPdf, syntheticPng } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import { FileTooLargeError, UnsupportedFormatError } from './errors.ts';
import type { IngestResult } from './existing-document.ts';
import { ingestFile } from './ingest-file.ts';
import {
  createIngestHarness,
  type IngestHarness,
  TEST_MAX_FILE_SIZE,
} from './harness.test-helper.ts';
import { startWatcher } from './watcher.ts';

describe('a watched folder feeding ingestFile', () => {
  let harness: IngestHarness;
  let dir: string;

  beforeAll(async () => {
    harness = await createIngestHarness();
    dir = await mkdtemp(join(tmpdir(), 'liasse-watch-ingest-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await harness.dispose();
  });

  const watchOnce = async (expectedOutcomes: number) => {
    const results: IngestResult[] = [];
    const errors: unknown[] = [];
    const watcher = startWatcher({
      dir,
      stabilityMs: 40,
      ingest: async (file) => {
        results.push(await ingestFile(harness.deps, { ...file, source: 'watch' }));
      },
      onError: (error) => errors.push(error),
    });
    await waitUntil(() => results.length + errors.length === expectedOutcomes);
    await watcher.stop();
    return { results, errors };
  };

  it('ingests each distinct file once, across restarts, and leaves the folder alone', async () => {
    const oversized = new Uint8Array(TEST_MAX_FILE_SIZE + 1);
    oversized.set(syntheticPdf('oversized'));
    await Promise.all([
      writeFile(join(dir, 'bill.pdf'), syntheticPdf('bill')),
      writeFile(join(dir, 'bill-copy.pdf'), syntheticPdf('bill')),
      writeFile(join(dir, 'scan.png'), syntheticPng('scan')),
      writeFile(join(dir, 'notes.txt'), 'synthetic unsupported text'),
      writeFile(join(dir, 'oversized.pdf'), oversized),
    ]);

    const first = await watchOnce(5);
    expect(first.results.filter(({ duplicate }) => !duplicate)).toHaveLength(2);
    expect(first.results.filter(({ duplicate }) => duplicate)).toHaveLength(1);
    expect(first.errors).toHaveLength(2);
    expect(first.errors.some((error) => error instanceof UnsupportedFormatError)).toBe(true);
    expect(first.errors.some((error) => error instanceof FileTooLargeError)).toBe(true);
    const rows = await harness.database.db.select().from(documents);
    expect(rows.map(({ mime }) => mime).sort()).toEqual(['application/pdf', 'image/png']);
    expect(rows.every(({ source }) => source === 'watch')).toBe(true);
    expect(await harness.database.db.select().from(jobs)).toHaveLength(2);

    const second = await watchOnce(5);
    expect(second.results.every(({ duplicate }) => duplicate)).toBe(true);
    expect(second.results).toHaveLength(3);
    expect(second.errors).toHaveLength(2);
    expect(await harness.database.db.select().from(documents)).toHaveLength(2);
    expect(await harness.database.db.select().from(jobs)).toHaveLength(2);
    expect(harness.puts()).toBe(2);
    expect((await readdir(dir)).sort()).toEqual([
      'bill-copy.pdf',
      'bill.pdf',
      'notes.txt',
      'oversized.pdf',
      'scan.png',
    ]);
  });

  it('does not bring a deleted document back after a restart', async () => {
    const db = harness.database.db;
    const [scan] = await db.select().from(documents).where(eq(documents.mime, 'image/png'));
    expect(await deleteDocument(harness.deps, scan?.id ?? '')).toBe(true);
    await db.delete(jobs);

    const restarted = await watchOnce(5);
    expect(restarted.results.map(({ status }) => status).sort()).toEqual([
      'deleted',
      'received',
      'received',
    ]);
    expect(restarted.results.every(({ duplicate }) => duplicate)).toBe(true);
    expect(await db.select().from(documents).where(isLiveDocument)).toHaveLength(1);
    expect(await db.select().from(jobs)).toEqual([]);
    expect((await readdir(dir)).includes('scan.png')).toBe(true);
  });
});
