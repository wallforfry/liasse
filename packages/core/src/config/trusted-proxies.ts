import { z } from 'zod';
import type { TrustedProxies } from '../network/client-address.ts';
import { parseSubnet, type Subnet } from '../network/subnet.ts';

const CLOUDFLARE_KEYWORD = 'cloudflare';

const isSubnet = (subnet: Subnet | undefined): subnet is Subnet => subnet !== undefined;

/**
 * `TRUSTED_PROXIES`: comma-separated addresses, CIDR ranges and the keyword `cloudflare`.
 * A rejected entry is named by its position only: the value stays out of the error.
 */
export const trustedProxies = z.string().transform((value, ctx): TrustedProxies => {
  // Positions count the empty entries too, so they match what the operator wrote.
  const entries = value.split(',').map((entry) => entry.trim());
  const holdsNoRange = (entry: string): boolean => entry === '' || entry === CLOUDFLARE_KEYWORD;
  const subnets = entries.map((entry) => (holdsNoRange(entry) ? undefined : parseSubnet(entry)));
  const rejected = entries.flatMap((entry, index) =>
    holdsNoRange(entry) || subnets[index] !== undefined ? [] : [index + 1],
  );
  rejected.forEach((position) => {
    ctx.addIssue({
      code: 'custom',
      message:
        `entry ${String(position)} is not an IP address, a CIDR range such as 10.0.0.0/8, ` +
        `or ${CLOUDFLARE_KEYWORD}`,
    });
  });
  if (rejected.length > 0) return z.NEVER;
  return Object.freeze({
    subnets: Object.freeze(subnets.filter(isSubnet)),
    cloudflare: entries.includes(CLOUDFLARE_KEYWORD),
  });
});
