import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EmbeddingCacheDirError,
  LocalModelProcessError,
  LocalModelRequestError,
  LocalModelTimeoutError,
} from './errors.ts';
import type { LocalModel } from './local-model.ts';
import { loadModelInChildProcess, startModelProcess } from './model-process.ts';

const run = promisify(execFile);
const FIXTURE = new URL('./model-child.fixture.ts', import.meta.url);
const SOURCE_FLAGS = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('startModelProcess', () => {
  const started: LocalModel[] = [];

  const start = (requestTimeoutMs?: number): LocalModel => {
    const model = startModelProcess({
      entry: FIXTURE,
      args: [],
      execArgv: SOURCE_FLAGS,
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    });
    started.push(model);
    return model;
  };

  const pidOf = async (model: LocalModel): Promise<number> => {
    const [vector] = await model.embed(['pid']);
    return vector?.[1] ?? Number.NaN;
  };

  afterEach(async () => {
    await Promise.all(started.splice(0).map((model) => model.dispose()));
  });

  it('answers each request with its own result, from another process', async () => {
    const model = start();
    const [vectors, counts, more] = await Promise.all([
      model.embed(['a', 'bcd']),
      model.countTokens(['one two three', 'one']),
      model.embed(['ab']),
    ]);
    expect(vectors.map((vector) => vector[0])).toEqual([1, 3]);
    expect(counts).toEqual([3, 1]);
    expect(more.map((vector) => vector[0])).toEqual([2]);
    expect(await pidOf(model)).not.toBe(process.pid);
  });

  it('rejects with the message of a failure reported by the model', async () => {
    const model = start();
    const failure = model.embed(['fail']);
    await expect(failure).rejects.toBeInstanceOf(LocalModelRequestError);
    await expect(failure).rejects.toThrow('synthetic model failure');
    await expect(failure).rejects.toMatchObject({ retryable: false });
    expect(await model.countTokens(['still alive'])).toEqual([2]);
  });

  it('reports a failed load as retryable, and loads at the next request', async () => {
    const model = start();
    const failure = model.embed(['load']);
    await expect(failure).rejects.toBeInstanceOf(LocalModelRequestError);
    await expect(failure).rejects.toMatchObject({ retryable: true });
    await expect(failure).rejects.toThrow('synthetic load failure');
    expect(await model.embed(['load'])).toHaveLength(1);
    expect(await model.countTokens(['load'])).toEqual([1]);
  });

  it('ends a process that does not answer in time, and rejects what it was asked', async () => {
    // Long enough for the process to start and answer a first request on a loaded machine.
    const model = start(2000);
    const pid = await pidOf(model);
    const stuck = model.embed(['hang']);
    const waiting = model.countTokens(['hang']);
    await expect(stuck).rejects.toBeInstanceOf(LocalModelTimeoutError);
    await expect(stuck).rejects.toMatchObject({ retryable: true });
    await expect(stuck).rejects.toThrow('did not answer within 2000 ms and was ended');
    await expect(waiting).rejects.toBeInstanceOf(LocalModelProcessError);
    await expect.poll(() => isRunning(pid), { timeout: 5000 }).toBe(false);
  });

  it('leaves alone a process that answered before the deadline', async () => {
    const model = start(2000);
    expect(await model.embed(['slow'])).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(await model.countTokens(['still alive'])).toEqual([2]);
  });

  it('rejects the requests in flight when the process dies, as retryable', async () => {
    const model = start();
    const inFlight = model.embed(['hang']);
    const crash = model.embed(['crash']);
    await expect(inFlight).rejects.toBeInstanceOf(LocalModelProcessError);
    await expect(inFlight).rejects.toMatchObject({ retryable: true });
    await expect(crash).rejects.toThrow('the model process ended (exit code 3)');
    await expect(model.embed(['a'])).rejects.toBeInstanceOf(LocalModelProcessError);
  });

  it('rejects the requests in flight when the process answers nonsense', async () => {
    const model = start();
    await expect(model.embed(['garbage'])).rejects.toBeInstanceOf(LocalModelProcessError);
  });

  it('ends the process on dispose and rejects what was in flight', async () => {
    const model = start();
    const pid = await pidOf(model);
    const rejected = expect(model.embed(['hang'])).rejects.toThrow('the model process was stopped');
    await model.dispose();
    await rejected;
    expect(isRunning(pid)).toBe(false);
    await model.dispose();
  });
});

describe('a server with a model process', () => {
  // The script exits on its own: nothing awaits, closes or kills the model process.
  const SCRIPT = `
    const { startModelProcess } = await import(process.argv[1]);
    const model = startModelProcess({
      entry: new URL(process.argv[2]),
      args: [],
      execArgv: ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'],
    });
    const [vector] = await model.embed(['pid']);
    process.stdout.write(JSON.stringify({ child: vector[1] }));
  `;

  it('exits while its idle model process is alive, takes it down, and keeps its stdout clean', async () => {
    const { stdout } = await run(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '--eval',
        SCRIPT,
        fileURLToPath(new URL('./model-process.ts', import.meta.url)),
        FIXTURE.href,
      ],
      { timeout: 10_000 },
    );
    const { child } = z.object({ child: z.number().int() }).parse(JSON.parse(stdout));
    await expect.poll(() => isRunning(child), { timeout: 5000 }).toBe(false);
  });
});

describe('a server that stops its model process', () => {
  const SCRIPT = `
    const { startModelProcess } = await import(process.argv[1]);
    const model = startModelProcess({
      entry: new URL(process.argv[2]),
      args: [],
      execArgv: ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'],
    });
    await model.embed(['pid']);
    await model.dispose();
    process.stdout.write('stopped');
  `;

  it('stays alive until the process has ended', async () => {
    const { stdout } = await run(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '--eval',
        SCRIPT,
        fileURLToPath(new URL('./model-process.ts', import.meta.url)),
        FIXTURE.href,
      ],
      { timeout: 10_000 },
    );
    expect(stdout).toBe('stopped');
  });
});

describe('a model process whose server is killed', () => {
  // Starts a request the model takes a while to answer, then tells which process serves it.
  const SCRIPT = `
    const { startModelProcess } = await import(process.argv[1]);
    const model = startModelProcess({
      entry: new URL(process.argv[2]),
      args: [],
      execArgv: ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'],
    });
    const [vector] = await model.embed(['pid']);
    void model.embed([process.argv[3]]);
    process.stdout.write(String(vector[1]) + '\\n');
  `;

  // `slow` answers after the server is gone; `busy` would keep working for ever.
  it.each(['slow', 'busy'])('ends quietly while it serves a %s request', async (command) => {
    const server = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '--eval',
        SCRIPT,
        fileURLToPath(new URL('./model-process.ts', import.meta.url)),
        FIXTURE.href,
        command,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const errors: string[] = [];
    server.stderr.setEncoding('utf8').on('data', (chunk: string) => errors.push(chunk));
    // The model process inherits this pipe: it closes once both processes are gone.
    const silence = once(server.stderr, 'close');
    const output: readonly unknown[] = await once(server.stdout.setEncoding('utf8'), 'data');
    const child = Number(String(output[0]).trim());
    server.kill('SIGKILL');
    await silence;
    expect(isRunning(child)).toBe(false);
    expect(errors.join('')).toBe('');
  });
});

describe('loadModelInChildProcess', () => {
  it('names EMBEDDING_CACHE_DIR when the directory cannot be created', async () => {
    const underAFile = `${fileURLToPath(import.meta.url)}/models`;
    const failure = loadModelInChildProcess({ model: 'synthetic/model', cacheDir: underAFile });
    await expect(failure).rejects.toBeInstanceOf(EmbeddingCacheDirError);
    await expect(failure).rejects.toThrow(/^EMBEDDING_CACHE_DIR cannot be used .*\(ENOTDIR\)/);
  });
});
