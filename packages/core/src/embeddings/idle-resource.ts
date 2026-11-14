export type CancelTimer = () => void;
export type ScheduleTimer = (callback: () => void, delayMs: number) => CancelTimer;

// Unref'd: a pending unload must never keep the process alive.
export const scheduleUnrefTimeout: ScheduleTimer = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
};

export interface IdleResourceOptions<T> {
  readonly load: () => Promise<T>;
  readonly dispose: (resource: T) => Promise<void>;
  readonly idleMs: number;
  readonly onUnloadError: (error: unknown) => void;
  readonly schedule?: ScheduleTimer;
}

export interface IdleResource<T> {
  readonly use: <R>(task: (resource: T) => Promise<R>) => Promise<R>;
  readonly unload: () => Promise<void>;
}

// Loads on first use, shares one instance between concurrent users and disposes of it once
// nobody has used it for `idleMs`.
export const createIdleResource = <T>({
  load,
  dispose,
  idleMs,
  onUnloadError,
  schedule = scheduleUnrefTimeout,
}: IdleResourceOptions<T>): IdleResource<T> => {
  let loaded: Promise<T> | undefined;
  let lastUnload: Promise<void> = Promise.resolve();
  let users = 0;
  let cancelIdleTimer: CancelTimer | undefined;

  const unload = async (): Promise<void> => {
    cancelIdleTimer?.();
    cancelIdleTimer = undefined;
    const current = loaded;
    if (current === undefined) return;
    loaded = undefined;
    // A load that failed left nothing to dispose of.
    const disposal = current.then(dispose, () => undefined);
    lastUnload = disposal.catch(() => undefined);
    await disposal;
  };

  // A use that arrives while the previous instance is being disposed of waits for the
  // disposal, then loads a fresh one: it never receives the instance going away.
  const acquire = (): Promise<T> => {
    cancelIdleTimer?.();
    cancelIdleTimer = undefined;
    if (loaded !== undefined) return loaded;
    const loading = lastUnload.then(load);
    loaded = loading;
    loading.catch(() => {
      if (loaded === loading) loaded = undefined;
    });
    return loading;
  };

  const release = (): void => {
    users -= 1;
    if (users > 0 || loaded === undefined) return;
    cancelIdleTimer = schedule(() => {
      unload().catch(onUnloadError);
    }, idleMs);
  };

  return {
    use: async (task) => {
      users += 1;
      try {
        return await task(await acquire());
      } finally {
        release();
      }
    },
    unload,
  };
};
