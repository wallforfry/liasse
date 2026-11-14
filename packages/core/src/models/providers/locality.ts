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

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'] as const;

const privateAddresses = PRIVATE_SUBNETS.reduce((list, [address, prefix, family]) => {
  list.addSubnet(address, prefix, family);
  return list;
}, new BlockList());

// Decided on the name alone, without a DNS lookup: an answer that depends on the resolver
// could change after startup. A name without a dot (a Compose service, a host of the local
// network) only resolves through the local resolver, so it counts as private.
export const isPrivateHost = (hostname: string): boolean => {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  const family = isIP(host);
  if (family !== 0) return privateAddresses.check(host, family === 4 ? 'ipv4' : 'ipv6');
  if (host === '') return false;
  return (
    host === 'localhost' ||
    !host.includes('.') ||
    PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
};

export const endpointHost = (
  provider: ModelProvider,
  baseUrl: string | undefined,
): string | undefined => {
  const url = baseUrl ?? PROVIDERS[provider].defaultBaseUrl;
  return url !== undefined && URL.canParse(url) ? new URL(url).hostname : undefined;
};

// Local means the content stays on this machine or its private network. It decides whether
// documents flagged `private` may be sent to the endpoint.
export const isLocalEndpoint = (provider: ModelProvider, baseUrl: string | undefined): boolean => {
  if (!PROVIDERS[provider].selfHosted) return false;
  const host = endpointHost(provider, baseUrl);
  return host !== undefined && isPrivateHost(host);
};
