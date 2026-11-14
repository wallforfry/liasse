export interface IdleDeadline {
  /** The child said something: its silence starts again. */
  readonly heard: () => void;
  /** A vision call is pending: the child waits for the server, which is no silence. */
  readonly waiting: () => void;
  readonly answered: () => void;
  readonly stop: () => void;
}

/** Calls `expire` once the child has been silent for `ms` with no vision call pending. */
export const createIdleDeadline = (ms: number, expire: () => void): IdleDeadline => {
  let pending = 0;
  let timer: NodeJS.Timeout | undefined;
  const rearm = (): void => {
    clearTimeout(timer);
    timer = pending > 0 ? undefined : setTimeout(expire, ms);
  };
  rearm();
  return {
    heard: rearm,
    waiting: () => {
      pending += 1;
      rearm();
    },
    answered: () => {
      pending -= 1;
      rearm();
    },
    stop: () => {
      clearTimeout(timer);
    },
  };
};
