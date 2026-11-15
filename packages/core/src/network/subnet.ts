import { BlockList, isIP } from 'node:net';

export type AddressFamily = 'ipv4' | 'ipv6';

/** A range of addresses: `network/prefix`, a single address having the full prefix. */
export interface Subnet {
  readonly network: string;
  readonly prefix: number;
  readonly family: AddressFamily;
}

const MAX_PREFIX: Readonly<Record<AddressFamily, number>> = { ipv4: 32, ipv6: 128 };

// How a dual-stack socket reports an IPv4 client: `::ffff:` then the IPv4 address.
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

// A zone index (`fe80::1%eth0`) names an interface of this machine, never a client.
const familyOf = (address: string): AddressFamily | undefined => {
  if (address.includes('%')) return undefined;
  const version = isIP(address);
  if (version === 4) return 'ipv4';
  if (version === 6) return 'ipv6';
  return undefined;
};

/**
 * The address as it is compared and handed on: trimmed, lowercase, and an IPv4 address
 * mapped into IPv6 read as the IPv4 address. Undefined for what is not an IP address.
 */
export const normalizeAddress = (value: string): string | undefined => {
  const trimmed = value.trim();
  const address = (IPV4_MAPPED.exec(trimmed)?.[1] ?? trimmed).toLowerCase();
  return familyOf(address) === undefined ? undefined : address;
};

/** `10.0.0.0/8`, `2001:db8::/32`, or one address. Undefined for anything else. */
export const parseSubnet = (value: string): Subnet | undefined => {
  const [address = '', prefixText, ...rest] = value.trim().split('/');
  const network = normalizeAddress(address);
  if (network === undefined || rest.length > 0) return undefined;
  const family = familyOf(network);
  if (family === undefined) return undefined;
  if (prefixText === undefined) return { network, prefix: MAX_PREFIX[family], family };
  if (!/^(0|[1-9]\d*)$/.test(prefixText)) return undefined;
  const prefix = Number(prefixText);
  return prefix <= MAX_PREFIX[family] ? { network, prefix, family } : undefined;
};

/** Whether a normalized address is in one of the subnets. */
export const subnetMatcher = (subnets: readonly Subnet[]): ((address: string) => boolean) => {
  const list = new BlockList();
  subnets.forEach(({ network, prefix, family }) => {
    list.addSubnet(network, prefix, family);
  });
  return (address) => {
    const family = familyOf(address);
    return family !== undefined && list.check(address, family);
  };
};
