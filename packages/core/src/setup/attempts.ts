import { normalizeIP } from '@better-auth/core/utils/ip';
import { sql } from 'drizzle-orm';
import { CLIENT_IPV6_SUBNET, SIGN_IN_ATTEMPTS_PER_MINUTE } from '../auth/create-auth.ts';
import type { Database } from '../db/client.ts';
import { authRateLimits } from '../db/schema/index.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';

/** Attempts at the setup token one client address may make per window, as for sign-in. */
export const SETUP_ATTEMPTS_PER_MINUTE = SIGN_IN_ATTEMPTS_PER_MINUTE;
const WINDOW_MS = 60_000;
const MS_PER_SECOND = 1000;

export type AttemptVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

// Requests without an address (handed to `fetch` directly) share one count, as they do for
// the sign-in limit of better-auth.
const keyOf = (address: string | undefined): string =>
  `setup|${address === undefined ? 'unknown' : normalizeIP(address, { ipv6Subnet: CLIENT_IPV6_SUBNET })}`;

/**
 * Counts one attempt of `address` in the table of the sign-in limit, with the same rule:
 * a window of a minute from the last allowed attempt, and a refusal past the limit that
 * does not move it. One statement, so concurrent attempts are all counted.
 */
export const countSetupAttempt = async (
  db: Database,
  address: string | undefined,
  now: number = Date.now(),
): Promise<AttemptVerdict> => {
  const { count, lastRequest } = authRateLimits;
  const expired = sql`${lastRequest} <= ${now - WINDOW_MS}`;
  const counted = sql`CASE WHEN ${expired} THEN 1 ELSE ${count} + 1 END`;
  const [row] = await db
    .insert(authRateLimits)
    .values({ id: newId(ID_PREFIXES.rateLimit), key: keyOf(address), count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        count: counted,
        lastRequest: sql`CASE WHEN ${counted} > ${SETUP_ATTEMPTS_PER_MINUTE} THEN ${lastRequest} ELSE ${now} END`,
      },
    })
    .returning({ count, lastRequest });
  if (row === undefined || row.count <= SETUP_ATTEMPTS_PER_MINUTE) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((row.lastRequest + WINDOW_MS - now) / MS_PER_SECOND)),
  };
};
