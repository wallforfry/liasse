import { describe, expect, it } from 'vitest';
import { clientKey, createLoginLimit } from './login-limit.ts';

const admittedCount = (limit: ReturnType<typeof createLoginLimit>, addresses: readonly string[]) =>
  addresses.map(limit).filter(({ admitted }) => admitted).length;

describe('clientKey', () => {
  it('counts an IPv6 address against its /64', () => {
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1%eth0')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
  });

  it('counts an IPv4 address as itself, also when written as IPv6', () => {
    expect(clientKey('192.0.2.7')).toBe('192.0.2.7');
    expect(clientKey('::ffff:192.0.2.7')).toBe('192.0.2.7');
  });
});

describe('createLoginLimit', () => {
  it('shares the attempts of every address of one /64', () => {
    const limit = createLoginLimit({ now: () => 0 });
    const addresses = Array.from({ length: 8 }, (_, index) => `2001:db8:1:2::${String(index + 1)}`);
    expect(admittedCount(limit, addresses)).toBe(5);
    expect(limit('2001:db8:1:3::1').admitted).toBe(true);
  });

  it('refuses new clients while it tracks as many as it may, until one expires', () => {
    const clock = { now: 0 };
    const limit = createLoginLimit({ maxClients: 3, now: () => clock.now });
    expect(admittedCount(limit, ['192.0.2.1', '192.0.2.2', '192.0.2.3'])).toBe(3);
    clock.now = 10_000;
    expect(limit('192.0.2.4')).toEqual({ admitted: false, retryAfterMs: 50_000 });
    expect(limit('192.0.2.1').admitted).toBe(true);
    clock.now = 60_001;
    expect(limit('192.0.2.4').admitted).toBe(true);
  });

  it('forgets a client once its attempts have left the window', () => {
    const clock = { now: 0 };
    const limit = createLoginLimit({ maxClients: 1, now: () => clock.now });
    expect(admittedCount(limit, Array(5).fill('192.0.2.9'))).toBe(5);
    expect(limit('192.0.2.9').admitted).toBe(false);
    clock.now = 60_000;
    expect(limit('192.0.2.10').admitted).toBe(true);
    expect(limit('192.0.2.9').admitted).toBe(false);
  });
});
