import { isIPv4, isIPv6 } from 'node:net';

export const LOGIN_ATTEMPTS_PER_WINDOW = 5;
export const LOGIN_WINDOW_MS = 60_000;
// Clients tracked at once. A client is forgotten when all its attempts have left the
// window; beyond this many, a client not tracked yet waits for one to be forgotten.
export const MAX_TRACKED_CLIENTS = 10_000;

export type Admission =
  { readonly admitted: true } | { readonly admitted: false; readonly retryAfterMs: number };

export type LoginLimit = (address: string) => Admission;

export interface LoginLimitOptions {
  readonly attempts?: number;
  readonly windowMs?: number;
  readonly maxClients?: number;
  readonly now?: () => number;
}

const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

const hextets = (address: string): readonly string[] => {
  const [head = '', tail] = address.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = Array.from({ length: 8 - left.length - right.length }, () => '0');
  return [...left, ...missing, ...right].map((part) => part.toLowerCase().replace(/^0+(?=.)/, ''));
};

/**
 * Who an attempt is counted against: an IPv4 address, or the /64 network of an IPv6 one,
 * since a single host commonly holds a whole /64. An IPv4 address written as IPv6 is
 * counted as itself.
 */
export const clientKey = (address: string): string => {
  const bare = address.split('%', 1)[0] ?? address;
  const mapped = IPV4_MAPPED.exec(bare)?.[1];
  if (mapped !== undefined && isIPv4(mapped)) return mapped;
  if (!isIPv6(bare)) return bare;
  return `${hextets(bare).slice(0, 4).join(':')}::/64`;
};

/**
 * At most `attempts` login attempts per client within a sliding window. Every attempt
 * counts, a successful one included, and is counted before the password is checked, so
 * the window also bounds the cost of hashing. Clients are kept in the order of their last
 * attempt, so the expired ones are dropped from the front without scanning the others.
 */
export const createLoginLimit = ({
  attempts = LOGIN_ATTEMPTS_PER_WINDOW,
  windowMs = LOGIN_WINDOW_MS,
  maxClients = MAX_TRACKED_CLIENTS,
  now = Date.now,
}: LoginLimitOptions = {}): LoginLimit => {
  const recent = new Map<string, readonly number[]>();
  const forgetExpired = (time: number): void => {
    for (const [key, times] of recent) {
      if ((times.at(-1) ?? 0) > time - windowMs) return;
      recent.delete(key);
    }
  };
  return (address) => {
    const time = now();
    forgetExpired(time);
    const key = clientKey(address);
    const kept = (recent.get(key) ?? []).filter((at) => at > time - windowMs);
    const [oldest] = kept;
    if (oldest !== undefined && kept.length >= attempts) {
      return { admitted: false, retryAfterMs: oldest + windowMs - time };
    }
    if (kept.length === 0 && recent.size >= maxClients) {
      const [first] = recent.values();
      return { admitted: false, retryAfterMs: (first?.at(-1) ?? time) + windowMs - time };
    }
    recent.delete(key);
    recent.set(key, [...kept, time]);
    return { admitted: true };
  };
};
