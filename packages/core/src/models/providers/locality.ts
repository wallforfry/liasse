import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { type ModelProvider, PROVIDERS } from './registry.ts';

const PRIVATE_SUBNETS = [
  ['127.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  // Carrier-grade NAT range, not routable on the Internet; overlay networks such as
  // Tailscale assign their addresses from it.
  ['100.64.0.0', 10, 'ipv4'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
] as const;

const privateAddresses = PRIVATE_SUBNETS.reduce((list, [address, prefix, family]) => {
  list.addSubnet(address, prefix, family);
  return list;
}, new BlockList());

// Loopback, private, link-local or unique-local. `BlockList` also matches an IPv4-mapped
// IPv6 address against the IPv4 ranges.
export const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);
  return family !== 0 && privateAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
};

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

const systemResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map(({ address }) => address);

// The system resolver has no deadline of its own: a name server that does not answer
// would hold the startup for as long as the operating system retries.
export const HOST_LOOKUP_TIMEOUT_MS = 3000;

export interface HostLookup {
  // The system resolver by default.
  readonly resolve?: HostResolver | undefined;
  readonly timeoutMs?: number | undefined;
}

// `unresolved` is a name whose lookup failed, timed out or returned no address. It is not
// local, and it is told apart from `external` only to be reported as such.
export type Locality = 'local' | 'external' | 'unresolved';

const NO_ADDRESS: readonly string[] = [];

// `dns.lookup` cannot be cancelled: past the deadline it is left to finish, unobserved.
const addressesOf = async (
  host: string,
  { resolve = systemResolver, timeoutMs = HOST_LOOKUP_TIMEOUT_MS }: HostLookup,
): Promise<readonly string[]> => {
  const settled = new AbortController();
  const deadline = delay(timeoutMs, NO_ADDRESS, { signal: settled.signal }).catch(() => NO_ADDRESS);
  try {
    return await Promise.race([resolve(host).catch(() => NO_ADDRESS), deadline]);
  } finally {
    settled.abort();
  }
};

// An IP literal is judged as written. A name is local only when it resolves and every
// address it resolves to is private: a name that looks private (`ai`, `evil.internal`)
// proves nothing, and neither does one address out of several.
export const hostLocality = async (
  hostname: string,
  lookup: HostLookup = {},
): Promise<Locality> => {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return isPrivateAddress(host) ? 'local' : 'external';
  const addresses = await addressesOf(host, lookup);
  if (addresses.length === 0) return 'unresolved';
  return addresses.every(isPrivateAddress) ? 'local' : 'external';
};

export const endpointHost = (
  provider: ModelProvider,
  baseUrl: string | undefined,
): string | undefined => {
  const url = baseUrl ?? PROVIDERS[provider].defaultBaseUrl;
  return url !== undefined && URL.canParse(url) ? new URL(url).hostname : undefined;
};

// Local means the content stays on this machine or its private network. It decides whether
// documents flagged `private` may be sent to the endpoint. The answer is the one of the
// moment it is asked: a later change of the DNS is not seen, and neither is a name that
// resolves again after a failed lookup.
export const endpointLocality = async (
  provider: ModelProvider,
  baseUrl: string | undefined,
  lookup?: HostLookup,
): Promise<Locality> => {
  if (!PROVIDERS[provider].selfHosted) return 'external';
  const host = endpointHost(provider, baseUrl);
  return host === undefined ? 'external' : hostLocality(host, lookup);
};

export const isLocalEndpoint = async (
  provider: ModelProvider,
  baseUrl: string | undefined,
  lookup?: HostLookup,
): Promise<boolean> => (await endpointLocality(provider, baseUrl, lookup)) === 'local';
