// A chain of holders: each waits for the one before it to let go.
export const createLock = (): (() => Promise<() => void>) => {
  let tail: Promise<void> = Promise.resolve();
  return async () => {
    const previous = tail;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    tail = previous.then(() => held);
    await previous;
    return release;
  };
};
