import { CLOUDFLARE_SUBNETS } from './cloudflare.ts';
import { normalizeAddress, type Subnet, subnetMatcher } from './subnet.ts';

/** `TRUSTED_PROXIES`: the proxies whose forwarded headers are believed. */
export interface TrustedProxies {
  readonly subnets: readonly Subnet[];
  /** The `cloudflare` keyword: Cloudflare's ranges, and its `CF-Connecting-IP` header. */
  readonly cloudflare: boolean;
}

export const NO_TRUSTED_PROXIES: TrustedProxies = Object.freeze({
  subnets: Object.freeze([]),
  cloudflare: false,
});

export const FORWARDED_FOR_HEADER = 'x-forwarded-for';
export const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip';

/** The address of the client, from the socket address of the request and its headers. */
export type ClientAddressResolver = (
  socketAddress: string | undefined,
  headers: Headers,
) => string | undefined;

interface Hops {
  /** The nearest proxy that was handed the request by someone it does not trust. */
  readonly relay: string;
  /** Who the relay was handed the request by, as far as anyone trusted can tell. */
  readonly client: string;
}

// Each trusted proxy appends the address it was connected from to X-Forwarded-For, so the
// list is read from the right and the first address no proxy vouches for is the client.
// Whatever stands left of it was written by the client and is never read. An entry that
// is not an address ends the walk on the proxy that wrote it.
const walk = (socket: string, headers: Headers, isTrusted: (address: string) => boolean): Hops => {
  const forwarded = (headers.get(FORWARDED_FOR_HEADER) ?? '')
    .split(',')
    .filter((entry) => entry.trim() !== '')
    .toReversed();
  let relay = socket;
  for (const entry of forwarded) {
    const hop = normalizeAddress(entry);
    if (hop === undefined) return { relay, client: relay };
    if (!isTrusted(hop)) return { relay, client: hop };
    relay = hop;
  }
  return { relay, client: relay };
};

/**
 * The socket address, unless the socket is a trusted proxy: then the right-most address of
 * `X-Forwarded-For` that no trusted proxy vouches for, or `CF-Connecting-IP` when the proxy
 * that received the request from outside is Cloudflare. Headers sent by anyone else are
 * never read.
 */
export const createClientAddressResolver = ({
  subnets,
  cloudflare,
}: TrustedProxies): ClientAddressResolver => {
  const isListed = subnetMatcher(subnets);
  const isCloudflare = cloudflare ? subnetMatcher(CLOUDFLARE_SUBNETS) : () => false;
  const isTrusted = (address: string): boolean => isListed(address) || isCloudflare(address);
  return (socketAddress, headers) => {
    if (socketAddress === undefined) return undefined;
    const socket = normalizeAddress(socketAddress);
    if (socket === undefined || !isTrusted(socket)) return socket ?? socketAddress;
    const { relay, client } = walk(socket, headers, isTrusted);
    const connecting = isCloudflare(relay)
      ? normalizeAddress(headers.get(CF_CONNECTING_IP_HEADER) ?? '')
      : undefined;
    return connecting ?? client;
  };
};
