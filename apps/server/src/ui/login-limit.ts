export const LOGIN_ATTEMPTS_PER_WINDOW = 5;
export const LOGIN_WINDOW_MS = 60_000;

export type Admission =
  { readonly admitted: true } | { readonly admitted: false; readonly retryAfterMs: number };

export type LoginLimit = (address: string) => Admission;

export interface LoginLimitOptions {
  readonly attempts?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}

/**
 * At most `attempts` login attempts per address within a sliding window. Every attempt
 * counts, a successful one included, and is counted before the password is checked, so
 * the window also bounds the cost of hashing. Addresses whose attempts all left the
 * window are forgotten.
 */
export const createLoginLimit = ({
  attempts = LOGIN_ATTEMPTS_PER_WINDOW,
  windowMs = LOGIN_WINDOW_MS,
  now = Date.now,
}: LoginLimitOptions = {}): LoginLimit => {
  const recent = new Map<string, readonly number[]>();
  return (address) => {
    const time = now();
    const inWindow = (at: number): boolean => at > time - windowMs;
    recent.forEach((times, key) => {
      if (!times.some(inWindow)) recent.delete(key);
    });
    const kept = (recent.get(address) ?? []).filter(inWindow);
    const [oldest] = kept;
    if (oldest !== undefined && kept.length >= attempts) {
      return { admitted: false, retryAfterMs: oldest + windowMs - time };
    }
    recent.set(address, [...kept, time]);
    return { admitted: true };
  };
};
