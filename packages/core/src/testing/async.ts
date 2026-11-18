const POLL_INTERVAL_MS = 10;
// Long on purpose: the wait ends as soon as the condition holds, so the bound only
// decides how long a missing effect takes to fail, never whether a slow one passes. It
// stays under the test timeout of the core project, so the failure names the wait.
const DEFAULT_TIMEOUT_MS = 20_000;

// For effects that land asynchronously (a job run by a worker, a file seen by a watcher).
// It rejects when the condition never holds, so a missing effect fails the test, and stops
// once `signal` aborts, such as the signal of a Vitest test that timed out.
export const waitUntil = async (
  condition: () => boolean | Promise<boolean>,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  }: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    signal?.throwIfAborted();
    if (Date.now() > deadline) {
      throw new Error(`The condition did not hold within ${String(timeoutMs)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
};

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface Gate<T = void> {
  readonly opened: Promise<T>;
  readonly open: (value: T) => void;
}

// Holds a concurrent step at a chosen point, so a test decides the interleaving.
// The step that opens it can hand a value over, such as the server process of its session.
export const createGate = <T = void>(): Gate<T> => {
  let open: (value: T) => void = () => undefined;
  const opened = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { opened, open };
};
