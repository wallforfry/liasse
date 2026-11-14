export type WakeReason = 'notified' | 'timeout';

export interface WakeSignal {
  readonly notify: () => void;
  readonly wait: (timeoutMs: number) => Promise<WakeReason>;
}

// A notification that arrives while nobody waits is kept for the next `wait`: the
// dispatcher is often busy claiming when a job is enqueued or a slot frees up.
export const createWakeSignal = (): WakeSignal => {
  let pending = false;
  let wake: (() => void) | undefined;

  return {
    notify: () => {
      pending = true;
      wake?.();
    },
    wait: (timeoutMs) =>
      new Promise((resolve) => {
        const finish = (reason: WakeReason): void => {
          clearTimeout(timer);
          wake = undefined;
          pending = false;
          resolve(reason);
        };
        const timer = setTimeout(() => {
          finish('timeout');
        }, timeoutMs);
        wake = () => {
          finish('notified');
        };
        if (pending) wake();
      }),
  };
};
