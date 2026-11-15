import { describe, expect, it } from 'vitest';
import {
  CF_CONNECTING_IP_HEADER,
  createClientAddressResolver,
  FORWARDED_FOR_HEADER,
  NO_TRUSTED_PROXIES,
  type TrustedProxies,
} from './client-address.ts';
import { parseSubnet, type Subnet } from './subnet.ts';

const subnets = (...values: readonly string[]): readonly Subnet[] =>
  values.map((value) => {
    const subnet = parseSubnet(value);
    if (subnet === undefined) throw new Error(`invalid test subnet ${value}`);
    return subnet;
  });

const trusting = (values: readonly string[], cloudflare = false): TrustedProxies => ({
  subnets: subnets(...values),
  cloudflare,
});

const headers = (values: Readonly<Record<string, string>>): Headers => new Headers(values);

// Addresses from the documentation ranges (RFC 5737, RFC 3849) and private ranges.
const PROXY = '10.0.0.2';
const CLOUDFLARE_EDGE = '172.70.1.1';
const CLOUDFLARE_EDGE_V6 = '2a06:98c1:3120::1';

describe('createClientAddressResolver', () => {
  it('keeps the socket address of an untrusted peer, whatever its headers claim', () => {
    const resolve = createClientAddressResolver(trusting([PROXY], true));
    const spoofed = headers({
      [FORWARDED_FOR_HEADER]: '198.51.100.1',
      [CF_CONNECTING_IP_HEADER]: '198.51.100.2',
    });
    expect(resolve('203.0.113.7', spoofed)).toBe('203.0.113.7');
  });

  it('reads no header at all without trusted proxies', () => {
    const resolve = createClientAddressResolver(NO_TRUSTED_PROXIES);
    expect(resolve(PROXY, headers({ [FORWARDED_FOR_HEADER]: '198.51.100.1' }))).toBe(PROXY);
  });

  it('has no address without a socket', () => {
    const resolve = createClientAddressResolver(trusting([PROXY]));
    expect(resolve(undefined, headers({ [FORWARDED_FOR_HEADER]: '198.51.100.1' }))).toBe(undefined);
  });

  it('takes the address a trusted proxy appended to X-Forwarded-For', () => {
    const resolve = createClientAddressResolver(trusting([PROXY]));
    expect(resolve(PROXY, headers({ [FORWARDED_FOR_HEADER]: '198.51.100.1' }))).toBe(
      '198.51.100.1',
    );
  });

  it('walks a chain of trusted proxies to the right-most untrusted address', () => {
    const resolve = createClientAddressResolver(trusting(['10.0.0.0/8', '192.168.1.5']));
    const chain = headers({
      [FORWARDED_FOR_HEADER]: '198.51.100.9, 198.51.100.1, 192.168.1.5,10.1.2.3',
    });
    expect(resolve(PROXY, chain)).toBe('198.51.100.1');
  });

  it('ignores the entries a client prepended to X-Forwarded-For', () => {
    const resolve = createClientAddressResolver(trusting([PROXY]));
    const prepended = headers({ [FORWARDED_FOR_HEADER]: '10.0.0.2, 198.51.100.50, 198.51.100.1' });
    expect(resolve(PROXY, prepended)).toBe('198.51.100.1');
  });

  it('reads every X-Forwarded-For header, the last one nearest', () => {
    const resolve = createClientAddressResolver(trusting([PROXY]));
    const repeated = new Headers();
    repeated.append(FORWARDED_FOR_HEADER, '198.51.100.50');
    repeated.append(FORWARDED_FOR_HEADER, '198.51.100.1');
    expect(resolve(PROXY, repeated)).toBe('198.51.100.1');
  });

  it('stops on the proxy when an entry is not an address', () => {
    const resolve = createClientAddressResolver(trusting(['10.0.0.0/8']));
    const malformed = headers({ [FORWARDED_FOR_HEADER]: '198.51.100.1, unknown, 10.0.0.3' });
    expect(resolve(PROXY, malformed)).toBe('10.0.0.3');
    expect(resolve(PROXY, headers({}))).toBe(PROXY);
  });

  it('prefers CF-Connecting-IP when the trusted peer is Cloudflare', () => {
    const resolve = createClientAddressResolver(trusting([], true));
    const fromCloudflare = headers({
      [FORWARDED_FOR_HEADER]: '198.51.100.50',
      [CF_CONNECTING_IP_HEADER]: '198.51.100.1',
    });
    expect(resolve(CLOUDFLARE_EDGE, fromCloudflare)).toBe('198.51.100.1');
  });

  it('reads CF-Connecting-IP behind a trusted proxy that only forwarded Cloudflare', () => {
    const resolve = createClientAddressResolver(trusting([PROXY], true));
    const viaProxy = headers({
      [FORWARDED_FOR_HEADER]: CLOUDFLARE_EDGE_V6,
      [CF_CONNECTING_IP_HEADER]: '2001:db8:1:2::3',
    });
    expect(resolve(PROXY, viaProxy)).toBe('2001:db8:1:2::3');
  });

  it('ignores CF-Connecting-IP from a client that reached the proxy directly', () => {
    const resolve = createClientAddressResolver(trusting([PROXY], true));
    const direct = headers({
      [FORWARDED_FOR_HEADER]: '203.0.113.7',
      [CF_CONNECTING_IP_HEADER]: '198.51.100.1',
    });
    expect(resolve(PROXY, direct)).toBe('203.0.113.7');
  });

  it('ignores CF-Connecting-IP and Cloudflare ranges without the cloudflare keyword', () => {
    const resolve = createClientAddressResolver(trusting([PROXY]));
    const fromCloudflare = headers({
      [FORWARDED_FOR_HEADER]: CLOUDFLARE_EDGE,
      [CF_CONNECTING_IP_HEADER]: '198.51.100.1',
    });
    expect(resolve(PROXY, fromCloudflare)).toBe(CLOUDFLARE_EDGE);
    expect(resolve(CLOUDFLARE_EDGE, fromCloudflare)).toBe(CLOUDFLARE_EDGE);
  });

  it('falls back on X-Forwarded-For when CF-Connecting-IP is not an address', () => {
    const resolve = createClientAddressResolver(trusting([], true));
    const broken = headers({
      [FORWARDED_FOR_HEADER]: '198.51.100.1',
      [CF_CONNECTING_IP_HEADER]: 'nonsense',
    });
    expect(resolve(CLOUDFLARE_EDGE, broken)).toBe('198.51.100.1');
  });

  it('matches IPv6 ranges and reads an IPv4-mapped socket address as IPv4', () => {
    const resolve = createClientAddressResolver(trusting(['fd00::/8', PROXY]));
    expect(resolve('fd12::1', headers({ [FORWARDED_FOR_HEADER]: '2001:DB8::7' }))).toBe(
      '2001:db8::7',
    );
    expect(resolve('::ffff:10.0.0.2', headers({ [FORWARDED_FOR_HEADER]: '198.51.100.1' }))).toBe(
      '198.51.100.1',
    );
    expect(resolve('::ffff:203.0.113.7', headers({}))).toBe('203.0.113.7');
  });
});
