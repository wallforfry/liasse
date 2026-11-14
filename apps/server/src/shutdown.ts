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
    readonly on: (signal: ShutdownSignal, listener: () => void) => unknown;
  };
  /** Stops everything. Resolves to false when something could not be stopped cleanly. */
  readonly stop: () => Promise<boolean>;
  /** Ends the process: nothing the shutdown left behind may keep it alive. */
  readonly exit: (code: number) => void;
}

// Exit code of a shutdown cut short by a second signal, as of one that did not stop cleanly.
const FORCED_EXIT_CODE = 1;

/**
 * The first SIGTERM or SIGINT stops everything, then exits with 0, or 1 when a step
 * failed. Any second one, the same or the other, exits at once with 1: it is the way out
 * of a shutdown that hangs.
 */
export const installShutdown = ({ signals, stop, exit }: ShutdownTargets): void => {
  let started = false;
  let exited = false;
  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    exit(code);
  };
  const shutdown = (): void => {
    if (started) {
      exitOnce(FORCED_EXIT_CODE);
      return;
    }
    started = true;
    stop().then(
      (clean) => {
        exitOnce(clean ? 0 : 1);
      },
      () => {
        exitOnce(1);
      },
    );
  };
  SHUTDOWN_SIGNALS.forEach((signal) => {
    signals.on(signal, shutdown);
  });
};
