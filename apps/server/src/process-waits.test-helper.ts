import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

// A process test spawns Node on the TypeScript sources, which migrates its own database,
// and drives it over HTTP or stdio: every step waits on the CPU and on the Postgres server
// shared with every other test file. Measured with 150 busy loops on 10 cores (load average
// 250) and both process test files at once, one such test took up to 73 s, against 1 to 4 s
// on an idle machine. These limits only end a hang: every wait of these tests ends on its
// condition, never on a time of its own.
export const PROCESS_TEST_LIMIT_MS = 180_000;

// Below the limit of the test, so that a condition that never holds fails with the message
// of `waitUntil`, not with Vitest's bare timeout.
export const PROCESS_WAIT_LIMIT_MS = 150_000;

/**
 * Resolves once `written()` includes `text`, checked on each chunk of `stream`. Rejects
 * when `child` closes first, with what it wrote, or when `signal` aborts. The listener
 * that fills `written` must be on `stream` already: listeners run in the order they were
 * added.
 */
export const untilWritten = (
  child: ChildProcess,
  stream: Readable,
  written: () => string,
  text: string,
  signal: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const settle = (outcome: () => void): void => {
      stream.off('data', check);
      child.off('close', closed);
      signal.removeEventListener('abort', aborted);
      outcome();
    };
    const check = (): void => {
      if (written().includes(text)) settle(resolve);
    };
    const closed = (): void => {
      settle(() => {
        reject(new Error(`the process closed before writing ${text}: ${written()}`));
      });
    };
    const aborted = (): void => {
      settle(() => {
        reject(new Error(`the test ended before the process wrote ${text}: ${written()}`));
      });
    };
    stream.on('data', check);
    child.once('close', closed);
    signal.addEventListener('abort', aborted);
    if (signal.aborted) aborted();
    else check();
  });
