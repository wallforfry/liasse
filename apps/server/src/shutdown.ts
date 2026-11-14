import { describeError, type Logger } from './log.ts';

export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface ShutdownStep {
  readonly name: string;
  readonly run: () => Promise<unknown>;
}

/**
 * Runs the steps in order. A step that fails is reported and the next ones still run:
 * a server that would not close must not keep the database pool open. Resolves to
 * whether every step succeeded.
 */
export const runShutdown = async (
  steps: readonly ShutdownStep[],
  logger: Logger,
): Promise<boolean> => {
  let clean = true;
  for (const { name, run } of steps) {
    try {
      await run();
    } catch (error) {
      clean = false;
      logger.event('shutdown_step_failed', { step: name, ...describeError(error) });
    }
  }
  return clean;
};

export interface ShutdownTargets {
  readonly signals: {
    readonly once: (signal: ShutdownSignal, listener: () => void) => unknown;
  };
  /** Stops everything. Resolves to false when something could not be stopped cleanly. */
  readonly stop: () => Promise<boolean>;
  /** Ends the process: nothing the shutdown left behind may keep it alive. */
  readonly exit: (code: number) => void;
}

export const installShutdown = ({ signals, stop, exit }: ShutdownTargets): void => {
  // Both signals share one shutdown: SIGINT arriving after SIGTERM must not stop twice.
  // Listeners are registered once, so repeating a signal falls back to Node's default
  // and ends the process at once, which is the way out of a shutdown that hangs.
  let started = false;
  const shutdown = (): void => {
    if (started) return;
    started = true;
    stop().then(
      (clean) => {
        exit(clean ? 0 : 1);
      },
      () => {
        exit(1);
      },
    );
  };
  SHUTDOWN_SIGNALS.forEach((signal) => {
    signals.once(signal, shutdown);
  });
};
