import { rmSync } from 'node:fs';
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGate, sleep, waitUntil } from '../testing/async.ts';
import { UnsupportedFormatError } from './errors.ts';
import type { WatchedFile } from './watch-visitor.ts';
import { startWatcher, type Watcher, type WatcherOptions } from './watcher.ts';

const STABILITY_MS = 60;
const NEVER_MS = 600_000;

interface Seen {
  readonly filename: string;
  readonly content: string;
}

describe('startWatcher', () => {
  let dir: string;
  let seen: Seen[];
  let errors: { readonly error: unknown; readonly path: string | undefined }[];
  const watchers: Watcher[] = [];

  const record = async ({ stream, filename }: WatchedFile): Promise<void> => {
    seen.push({ filename, content: (await buffer(stream)).toString('utf8') });
  };

  const start = (options: Partial<WatcherOptions> = {}): Watcher => {
    const watcher = startWatcher({
      dir,
      ingest: record,
      stabilityMs: STABILITY_MS,
      rescanIntervalMs: NEVER_MS,
      onError: (error, path) => errors.push({ error, path }),
      ...options,
    });
    watchers.push(watcher);
    return watcher;
  };

  const names = (): readonly string[] => seen.map(({ filename }) => filename).sort();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'liasse-watch-'));
    seen = [];
    errors = [];
  });

  afterEach(async () => {
    await Promise.all(watchers.splice(0).map((watcher) => watcher.stop()));
    await rm(dir, { recursive: true, force: true });
  });

  it('does nothing when no directory is configured', async () => {
    const watcher = startWatcher({ dir: undefined, ingest: record });
    await expect(watcher.stop()).resolves.toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('ingests the files already present at start, at any depth', async () => {
    await mkdir(join(dir, 'bills', '2026'), { recursive: true });
    await writeFile(join(dir, 'top.pdf'), 'top');
    await writeFile(join(dir, 'bills', '2026', 'nested.pdf'), 'nested');
    start();
    await waitUntil(() => seen.length === 2);
    expect([...seen].sort((a, b) => a.filename.localeCompare(b.filename))).toEqual([
      { filename: 'nested.pdf', content: 'nested' },
      { filename: 'top.pdf', content: 'top' },
    ]);
    expect(errors).toEqual([]);
  });

  it('ingests a file dropped later, without waiting for a rescan', async () => {
    start();
    await sleep(3 * STABILITY_MS);
    await mkdir(join(dir, 'late'));
    await writeFile(join(dir, 'late', 'dropped.pdf'), 'dropped');
    await waitUntil(() => seen.length === 1);
    expect(seen).toEqual([{ filename: 'dropped.pdf', content: 'dropped' }]);
  });

  it('finds new files by rescanning when the file system sends no events', async () => {
    start({ fsEvents: false, rescanIntervalMs: 50 });
    await sleep(3 * STABILITY_MS);
    await writeFile(join(dir, 'polled.pdf'), 'polled');
    await waitUntil(() => seen.length === 1);
    expect(names()).toEqual(['polled.pdf']);
  });

  it('sees nothing new without events nor rescan', async () => {
    start({ fsEvents: false });
    await sleep(3 * STABILITY_MS);
    await writeFile(join(dir, 'unseen.pdf'), 'unseen');
    await sleep(6 * STABILITY_MS);
    expect(seen).toEqual([]);
  });

  it('waits for a file that is still being written', async () => {
    start({ stabilityMs: 300 });
    const path = join(dir, 'growing.pdf');
    await writeFile(path, 'part-0');
    for (const part of [1, 2, 3, 4, 5, 6]) {
      await sleep(100);
      await appendFile(path, ` part-${String(part)}`);
      expect(seen).toEqual([]);
    }
    await waitUntil(() => seen.length === 1);
    expect(seen[0]?.content).toBe('part-0 part-1 part-2 part-3 part-4 part-5 part-6');
    await sleep(700);
    expect(seen).toHaveLength(1);
  });

  it('ignores dotfiles, hidden directories and temporary files', async () => {
    await mkdir(join(dir, '.hidden'));
    await mkdir(join(dir, 'visible'));
    await Promise.all(
      [
        '.DS_Store',
        '.hidden/inside.pdf',
        'download.pdf.part',
        'download.pdf.crdownload',
        'draft.TMP',
        'backup.pdf~',
        '~$letter.docx',
        'visible/.partial.pdf',
        'visible/kept.pdf',
      ].map((name) => writeFile(join(dir, name), name)),
    );
    start();
    await waitUntil(() => seen.length === 1);
    await sleep(4 * STABILITY_MS);
    expect(names()).toEqual(['kept.pdf']);
  });

  it('reports an unreadable directory once and ingests everything else', async () => {
    const locked = join(dir, 'lost+found');
    await mkdir(locked);
    await mkdir(join(dir, 'readable'));
    await writeFile(join(dir, 'bill.pdf'), 'bill');
    await writeFile(join(dir, 'readable', 'scan.pdf'), 'scan');
    await chmod(locked, 0o000);
    try {
      start({ fsEvents: false, rescanIntervalMs: 20 });
      await waitUntil(() => seen.length === 2);
      await sleep(15 * 20);
      expect(names()).toEqual(['bill.pdf', 'scan.pdf']);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ path: locked, error: { code: 'EACCES' } });
    } finally {
      await chmod(locked, 0o700);
    }
  });

  it('reports a directory again once it was readable in between', async () => {
    const locked = join(dir, 'lost+found');
    await mkdir(locked);
    await chmod(locked, 0o000);
    try {
      start({ fsEvents: false, rescanIntervalMs: 20 });
      await waitUntil(() => errors.length === 1);
      await chmod(locked, 0o700);
      await writeFile(join(locked, 'found.pdf'), 'found');
      await waitUntil(() => seen.length === 1);
      await chmod(locked, 0o000);
      await waitUntil(() => errors.length === 2);
    } finally {
      await chmod(locked, 0o700);
    }
  });

  it('leaves the files of the user where they are, untouched', async () => {
    await writeFile(join(dir, 'kept.pdf'), 'kept');
    await writeFile(join(dir, 'refused.txt'), 'refused');
    start({
      ingest: async (file) => {
        await record(file);
        if (file.filename === 'refused.txt') throw new UnsupportedFormatError();
      },
    });
    await waitUntil(() => seen.length === 2);
    await sleep(2 * STABILITY_MS);
    expect((await readdir(dir)).sort()).toEqual(['kept.pdf', 'refused.txt']);
    expect(await readFile(join(dir, 'kept.pdf'), 'utf8')).toBe('kept');
    expect(await readFile(join(dir, 'refused.txt'), 'utf8')).toBe('refused');
  });

  it('reads an unchanged file once, and again when it changes', async () => {
    const path = join(dir, 'changing.pdf');
    await writeFile(path, 'first version');
    start({ fsEvents: false, rescanIntervalMs: 30 });
    await waitUntil(() => seen.length === 1);
    await sleep(10 * 30);
    expect(seen).toHaveLength(1);
    await writeFile(path, 'second version, longer');
    await waitUntil(() => seen.length === 2);
    expect(seen[1]?.content).toBe('second version, longer');
  });

  it('does not read a refused file again, however many rescans follow', async () => {
    await writeFile(join(dir, 'notes.txt'), 'unsupported');
    start({
      fsEvents: false,
      rescanIntervalMs: 20,
      ingest: async (file) => {
        await record(file);
        throw new UnsupportedFormatError();
      },
    });
    await waitUntil(() => seen.length === 1);
    await sleep(15 * 20);
    expect(seen).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: join(dir, 'notes.txt') });
    expect(errors[0]?.error).toBeInstanceOf(UnsupportedFormatError);
  });

  it('retries a failure unrelated to the file, one rescan interval later', async () => {
    await writeFile(join(dir, 'retried.pdf'), 'retried');
    const attemptedAt: number[] = [];
    start({
      fsEvents: false,
      stabilityMs: 20,
      rescanIntervalMs: 300,
      ingest: async (file) => {
        attemptedAt.push(Date.now());
        if (attemptedAt.length === 1) throw new Error('synthetic database outage');
        await record(file);
      },
    });
    await waitUntil(() => seen.length === 1);
    expect(attemptedAt).toHaveLength(2);
    expect((attemptedAt[1] ?? 0) - (attemptedAt[0] ?? 0)).toBeGreaterThanOrEqual(295);
    expect(errors).toHaveLength(1);
  });

  it('survives a file that disappears while it is read', async () => {
    await writeFile(join(dir, 'a-vanishing.pdf'), 'vanishing');
    await writeFile(join(dir, 'b-staying.pdf'), 'staying');
    start({
      ingest: async (file) => {
        if (file.filename === 'a-vanishing.pdf') rmSync(join(dir, file.filename));
        await record(file);
      },
    });
    await waitUntil(() => seen.length === 1);
    await sleep(3 * STABILITY_MS);
    expect(seen).toEqual([{ filename: 'b-staying.pdf', content: 'staying' }]);
    expect(errors).toEqual([]);
  });

  it('reports a directory that does not exist and starts once it appears', async () => {
    const missing = join(dir, 'not-created-yet');
    start({ dir: missing, rescanIntervalMs: 40 });
    await waitUntil(() => errors.length > 0);
    expect(errors[0]).toMatchObject({ path: undefined, error: { code: 'ENOENT' } });
    await mkdir(missing);
    await writeFile(join(missing, 'appeared.pdf'), 'appeared');
    await waitUntil(() => seen.length === 1);
    expect(names()).toEqual(['appeared.pdf']);
  });

  it('finishes the ingestion in progress on stop, then ingests nothing more', async () => {
    await writeFile(join(dir, 'a-first.pdf'), 'first');
    await writeFile(join(dir, 'b-second.pdf'), 'second');
    const entered = createGate();
    const proceed = createGate();
    const started: string[] = [];
    const watcher = start({
      ingest: async (file) => {
        started.push(file.filename);
        entered.open();
        await proceed.opened;
        await record(file);
      },
    });
    await entered.opened;
    const stopping = watcher.stop();
    const stoppedEarly = await Promise.race([
      stopping.then(() => true),
      sleep(100).then(() => false),
    ]);
    expect(stoppedEarly).toBe(false);
    proceed.open();
    await stopping;
    // The folder is listed in the order of the file system, which ext4 does not keep by
    // name: whichever file came first is the one in progress, and the only one ingested.
    expect(started).toHaveLength(1);
    expect(names()).toEqual(started);
    await writeFile(join(dir, 'c-after-stop.pdf'), 'after');
    await sleep(4 * STABILITY_MS);
    expect(names()).toEqual(started);
  });
});
