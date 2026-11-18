import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitUntil } from '../../testing/async.ts';
import { runPoppler, runPopplerUntil } from './poppler.ts';

const KEPT_STDERR_BYTES = 16 * 1024;
const INVALID_GEOMETRY = 'Syntax Error: hDPI or vDPI values are invalid\n';
const UNLIMITED = { timeoutMs: 30_000, signal: undefined };

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('runPoppler', () => {
  let tempRoot = '';
  let started: readonly number[] = [];

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'liasse-poppler-test-'));
    started = [];
  });

  afterEach(async () => {
    started.filter(isAlive).forEach((pid) => process.kill(pid, 'SIGKILL'));
    await waitUntil(() => !started.some(isAlive));
    await rm(tempRoot, { recursive: true, force: true });
  });

  const script = async (body: string, mode = 0o755): Promise<string> => {
    const command = join(tempRoot, 'fake-poppler');
    await writeFile(command, `#!/bin/sh\n${body}\n`);
    await chmod(command, mode);
    return command;
  };

  const printing = async (stream: 'stdout' | 'stderr', content: string): Promise<string> => {
    const file = join(tempRoot, 'content');
    await writeFile(file, content);
    return script(stream === 'stdout' ? `cat "${file}"` : `cat "${file}" >&2\nexit 1`);
  };

  // The command starts a process that inherits its pipes, reports the id of that process
  // and waits for it, as a wrapper script around poppler would.
  const forking = async (grandchild: string): Promise<{ command: string; pidFile: string }> => {
    const pidFile = join(tempRoot, 'grandchild-pid');
    const command = await script(`${grandchild} &\necho $! > "${pidFile}"\nwait`);
    return { command, pidFile };
  };

  const grandchildOf = async (pidFile: string): Promise<number> => {
    const content = (): Promise<string> => readFile(pidFile, 'utf8').catch(() => '');
    await waitUntil(async () => (await content()).endsWith('\n'));
    const pid = Number((await content()).trim());
    started = [...started, pid];
    return pid;
  };

  const outcomeOf = (run: Promise<void>): Promise<unknown> =>
    run.then(
      () => 'resolved',
      (error: unknown) => error,
    );

  it('hands over all of stdout, in order', async () => {
    const content = Array.from({ length: 20_000 }, (_, index) => `line ${String(index)}\n`).join(
      '',
    );
    const chunks: Uint8Array[] = [];
    await runPoppler(await printing('stdout', content), [], UNLIMITED, (chunk) => {
      chunks.push(chunk);
    });
    expect(Buffer.concat(chunks).toString('utf8')).toBe(content);
  });

  it('keeps the last 16 KiB of stderr and not a byte more', async () => {
    const padding = (bytes: number): string => `${'x'.repeat(bytes - 1)}\n`;
    const kept = `${INVALID_GEOMETRY}${padding(KEPT_STDERR_BYTES - INVALID_GEOMETRY.length)}`;
    expect(kept).toHaveLength(KEPT_STDERR_BYTES);
    expect(
      await outcomeOf(runPoppler(await printing('stderr', kept), [], UNLIMITED)),
    ).toMatchObject({ code: 'pdf_page_unrenderable' });
    const cut = `${INVALID_GEOMETRY}${padding(KEPT_STDERR_BYTES - INVALID_GEOMETRY.length + 1)}`;
    expect(await outcomeOf(runPoppler(await printing('stderr', cut), [], UNLIMITED))).toMatchObject(
      { code: 'pdf_renderer_failed' },
    );
  });

  // The deadline passes once the grandchild runs, however long the shell took to start
  // it. The grandchild holds the pipes for ten minutes: a report that waited for them to
  // close would arrive after it died, and it is still alive when the report is read.
  it('reports a timeout when the command is killed, not when its pipes close', async () => {
    const { command, pidFile } = await forking('sleep 600');
    const deadline = new AbortController();
    const outcome = outcomeOf(
      runPopplerUntil(command, [], { ...UNLIMITED, deadline: deadline.signal }),
    );
    const grandchild = await grandchildOf(pidFile);
    deadline.abort();
    expect(await outcome).toMatchObject({ code: 'pdf_renderer_timeout', retryable: true });
    expect(isAlive(grandchild)).toBe(true);
  });

  it('lets go of the pipes on a timeout, which ends a process still writing to them', async () => {
    const { command, pidFile } = await forking('( while echo synthetic; do sleep 0.05; done )');
    const deadline = new AbortController();
    const outcome = outcomeOf(
      runPopplerUntil(command, [], { ...UNLIMITED, deadline: deadline.signal }),
    );
    const grandchild = await grandchildOf(pidFile);
    deadline.abort();
    expect(await outcome).toMatchObject({ code: 'pdf_renderer_timeout' });
    await waitUntil(() => !isAlive(grandchild));
  });

  // The command never ends on its own, so the outcome is a timeout whether the deadline
  // passes before the shell starts or after.
  it('kills the command once it has run for the given time', async () => {
    const command = await script('exec sleep 600');
    const failure = runPoppler(command, [], { timeoutMs: 50, signal: undefined });
    await expect(failure).rejects.toMatchObject({ code: 'pdf_renderer_timeout' });
    await expect(failure).rejects.toThrow('took longer than 50 ms');
  });

  // Only the timers are faked, and only for the run: the child process and its pipes are
  // real, and the helpers of this file poll with real timers.
  it('clears its deadline once the command has ended', async () => {
    const command = await script('exit 0');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const run = runPoppler(command, [], UNLIMITED);
      expect(vi.getTimerCount()).toBe(1);
      await run;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a command without the execute bit as unavailable for good', async () => {
    const command = await script('exit 0', 0o644);
    const failure = runPoppler(command, [], UNLIMITED);
    await expect(failure).rejects.toMatchObject({ code: 'pdf_renderer_missing', retryable: false });
    await expect(failure).rejects.toThrow('is not executable');
  });

  it('reports a command that does not exist as unavailable for good', async () => {
    const failure = runPoppler(join(tempRoot, 'absent'), [], UNLIMITED);
    await expect(failure).rejects.toMatchObject({ code: 'pdf_renderer_missing', retryable: false });
    await expect(failure).rejects.toThrow('poppler-utils');
  });
});
