import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGate } from '../testing/async.ts';
import { LocalModelClosedError, LocalModelTimeoutError } from './errors.ts';
import type { LocalModel } from './local-model.ts';
import { createLocalEmbedder, type LocalEmbedder } from './local.ts';
import { startModelProcess } from './model-process.ts';

const run = promisify(execFile);

// ONNX Runtime is a native addon, so the shared objects of the process tell whether it was
// loaded. Only a fresh process gives a trustworthy answer.
const SCRIPT = `
  const { createLocalEmbedder } = await import(process.argv[1]);
  createLocalEmbedder({ dimension: 384, cacheDir: '/synthetic/models' });
  const loaded = process.report.getReport().sharedObjects.some((path) => /onnxruntime/i.test(path));
  process.stdout.write(JSON.stringify({ onnxRuntimeLoaded: loaded }));
`;

describe('an idle local embedder', () => {
  it('does not load ONNX Runtime', async () => {
    const { stdout } = await run(process.execPath, [
      '--conditions=@liasse/source',
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      SCRIPT,
      fileURLToPath(new URL('./local.ts', import.meta.url)),
    ]);
    expect(JSON.parse(stdout)).toEqual({ onnxRuntimeLoaded: false });
  });
});

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

describe('a local embedder over a model process', () => {
  const opened: LocalEmbedder[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(opened.splice(0).map((embedder) => embedder.close()));
  });

  // The fixture answers `pid` to `countTokens` with the id of the process that serves it.
  // A model process arms the deadline of a request as it is handed the request, which
  // `handedOver(count)` tells once `count` requests were.
  const open = (requestTimeoutMs?: number) => {
    let started = 0;
    let asked = 0;
    const handed = Array.from({ length: 8 }, createGate);
    const counted = (model: LocalModel): LocalModel => ({
      ...model,
      countTokens: (texts) => {
        const answer = model.countTokens(texts);
        handed[asked]?.open();
        asked += 1;
        return answer;
      },
    });
    const embedder = createLocalEmbedder({
      dimension: 2,
      cacheDir: '/synthetic/models',
      model: 'synthetic/fixture',
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      loadModel: (spec) => {
        started += 1;
        return Promise.resolve(
          counted(
            startModelProcess({
              entry: FIXTURE,
              args: [],
              execArgv: SOURCE_FLAGS,
              ...(spec.requestTimeoutMs === undefined
                ? {}
                : { requestTimeoutMs: spec.requestTimeoutMs }),
            }),
          ),
        );
      },
    });
    opened.push(embedder);
    const handedOver = (count: number): Promise<void> =>
      handed[count - 1]?.opened ??
      Promise.reject(new Error(`only ${String(handed.length)} requests are counted`));
    return { embedder, processesStarted: () => started, handedOver };
  };

  it('ends its process on close and starts none for the request in flight', async () => {
    const { embedder, processesStarted } = open();
    const [pid = Number.NaN] = await embedder.countTokens(['pid']);
    const inFlight = embedder.countTokens(['hang']).catch((error: unknown) => error);
    await embedder.close();
    expect(await inFlight).toBeInstanceOf(LocalModelClosedError);
    expect(isRunning(pid)).toBe(false);
    expect(processesStarted()).toBe(1);
  });

  // `block` holds the model process, so the request sent after it is never read. Only the
  // first one ran out of time: the other is served by the process that replaces it. The
  // deadlines are timers of this process, moved by hand: one passes when the test says so,
  // never because a process was slow to start on a loaded machine.
  it('times out the request a process did not answer and runs the others again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { embedder, processesStarted, handedOver } = open(3000);
    const [first] = await embedder.countTokens(['pid']);
    const stuck = embedder.countTokens(['block']).catch((error: unknown) => error);
    const bystander = embedder.countTokens(['pid']);
    await handedOver(3);
    vi.advanceTimersByTime(3000);
    expect(await stuck).toBeInstanceOf(LocalModelTimeoutError);
    const [second] = await bystander;
    expect(second).not.toBe(first);
    expect(processesStarted()).toBe(2);
  });
});
