const EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;
type Signal = keyof typeof EXIT_CODES;
const SIGNALS: readonly Signal[] = ['SIGINT', 'SIGTERM'];

/** The part of `process` this needs: a test hands an emitter of its own. */
export interface SignalSource {
  readonly once: (signal: Signal, listener: () => void) => unknown;
  readonly off: (signal: Signal, listener: () => void) => unknown;
}

export interface InterruptOptions {
  readonly source?: SignalSource;
  readonly exit?: (code: number) => void;
}

/**
 * Runs `work`; a SIGINT or a SIGTERM meanwhile runs `cleanup` and then ends the process
 * with the code of the signal. Without it, an interrupted run would leave its throwaway
 * database and folder behind: the signal ends the process before any `finally` runs.
 */
export const cleanUpOnInterrupt = async <Result>(
  cleanup: () => Promise<void>,
  work: () => Promise<Result>,
  { source = process, exit = (code) => process.exit(code) }: InterruptOptions = {},
): Promise<Result> => {
  const listeners = SIGNALS.map((signal) => {
    const listener = (): void => {
      void cleanup().finally(() => {
        exit(EXIT_CODES[signal]);
      });
    };
    source.once(signal, listener);
    return { signal, listener };
  });
  try {
    return await work();
  } finally {
    listeners.forEach(({ signal, listener }) => source.off(signal, listener));
  }
};
