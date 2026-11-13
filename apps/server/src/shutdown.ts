export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface ShutdownTargets {
  readonly signals: {
    readonly once: (signal: ShutdownSignal, listener: () => void) => unknown;
  };
  readonly server: {
    readonly close: (callback: (error?: Error) => void) => unknown;
  };
  readonly database: {
    readonly close: () => Promise<void>;
  };
}

export const installShutdown = ({ signals, server, database }: ShutdownTargets): void => {
  // Both signals share one shutdown: SIGINT arriving after SIGTERM must not close twice.
  // Listeners are registered once, so repeating a signal falls back to Node's default
  // and ends the process at once, which is the way out of a shutdown that hangs.
  let started = false;
  const shutdown = (): void => {
    if (started) return;
    started = true;
    server.close(() => {
      void database.close();
    });
  };
  SHUTDOWN_SIGNALS.forEach((signal) => {
    signals.once(signal, shutdown);
  });
};
