import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
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

// An IP literal is judged as written. A name is local only when it resolves and every
// address it resolves to is private: a name that looks private (`ai`, `evil.internal`)
// proves nothing, and neither does one address out of several.
export const isLocalHost = async (
  hostname: string,
  resolve: HostResolver = systemResolver,
): Promise<boolean> => {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return isPrivateAddress(host);
  const addresses = await resolve(host).catch(() => []);
  return addresses.length > 0 && addresses.every(isPrivateAddress);
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
// moment it is asked: a later change of the DNS is not seen.
export const isLocalEndpoint = async (
  provider: ModelProvider,
  baseUrl: string | undefined,
  resolve?: HostResolver,
): Promise<boolean> => {
  if (!PROVIDERS[provider].selfHosted) return false;
  const host = endpointHost(provider, baseUrl);
  return host !== undefined && (await isLocalHost(host, resolve));
};
