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

export interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

// Holds a concurrent step at a chosen point, so a test decides the interleaving.
export const createGate = (): Gate => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
};
