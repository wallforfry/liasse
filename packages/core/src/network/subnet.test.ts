import { describe, expect, it } from 'vitest';
import { CLOUDFLARE_RANGES, CLOUDFLARE_SUBNETS } from './cloudflare.ts';
import { normalizeAddress, parseSubnet, subnetMatcher } from './subnet.ts';

describe('parseSubnet', () => {
  it('reads addresses and CIDR ranges of both families', () => {
    expect(parseSubnet('10.0.0.0/8')).toEqual({ network: '10.0.0.0', prefix: 8, family: 'ipv4' });
    expect(parseSubnet(' 192.0.2.1 ')).toEqual({
      network: '192.0.2.1',
      prefix: 32,
      family: 'ipv4',
    });
    expect(parseSubnet('2001:DB8::/32')).toEqual({
      network: '2001:db8::',
      prefix: 32,
      family: 'ipv6',
    });
    expect(parseSubnet('::1')).toEqual({ network: '::1', prefix: 128, family: 'ipv6' });
  });

  it.each([
    '',
    'cloudflare',
    '10.0.0.0/33',
    '2001:db8::/129',
    '10.0.0.0/',
    '10.0.0.0/08',
    '10.0.0.0/8/8',
    '10.0.0.0/-1',
    '10.0.0',
    'fe80::1%eth0',
    'proxy.example.com',
  ])('refuses %j', (value) => {
    expect(parseSubnet(value)).toBe(undefined);
  });
});

describe('normalizeAddress', () => {
  it('reads an IPv4-mapped IPv6 address as IPv4 and lowercases IPv6', () => {
    expect(normalizeAddress('::FFFF:192.0.2.1')).toBe('192.0.2.1');
    expect(normalizeAddress(' 2001:DB8::1 ')).toBe('2001:db8::1');
    expect(normalizeAddress('192.0.2.1:443')).toBe(undefined);
  });
});

describe('subnetMatcher', () => {
  it('matches an address inside a range and nothing outside', () => {
    const matches = subnetMatcher([
      { network: '10.0.0.0', prefix: 8, family: 'ipv4' },
      { network: '2001:db8::', prefix: 32, family: 'ipv6' },
    ]);
    expect(matches('10.255.0.1')).toBe(true);
    expect(matches('11.0.0.1')).toBe(false);
    expect(matches('2001:db8:ffff::1')).toBe(true);
    expect(matches('2001:db9::1')).toBe(false);
    expect(matches('not an address')).toBe(false);
  });
});

describe('the bundled Cloudflare ranges', () => {
  it('are all valid ranges of both families', () => {
    expect(CLOUDFLARE_SUBNETS).toHaveLength(CLOUDFLARE_RANGES.length);
    expect(new Set(CLOUDFLARE_SUBNETS.map(({ family }) => family))).toEqual(
      new Set(['ipv4', 'ipv6']),
    );
  });
});
