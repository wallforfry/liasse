import { describe, expect, it, vi } from 'vitest';
import {
  endpointLocality,
  HOST_LOOKUP_TIMEOUT_MS,
  type HostResolver,
  hostLocality,
  isLocalEndpoint,
  isPrivateAddress,
} from './locality.ts';

const PUBLIC_ADDRESS = '203.0.113.7';

// Stands for the DNS of a deployment: a Compose service, a split-horizon name that
// answers a public address, and a name with one private and one public address.
const ANSWERS: Readonly<Record<string, readonly string[]>> = {
  localhost: ['127.0.0.1', '::1'],
  ollama: ['172.18.0.5'],
  'gpu-box.local': ['192.168.1.20', 'fe80::1'],
  ai: [PUBLIC_ADDRESS],
  'evil.internal': [PUBLIC_ADDRESS],
  'mixed.example': ['10.0.0.1', PUBLIC_ADDRESS],
  'empty.example': [],
};

const resolve: HostResolver = (hostname) => {
  const addresses = ANSWERS[hostname];
  return addresses === undefined
    ? Promise.reject(new Error(`ENOTFOUND ${hostname}`))
    : Promise.resolve(addresses);
};

const resolveEverythingToPublic: HostResolver = () => Promise.resolve([PUBLIC_ADDRESS]);

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '127.8.9.10',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.20',
    '169.254.10.10',
    '100.64.0.1',
    '100.127.255.254',
    '::1',
    'fd12:3456:789a::1',
    'fe80::1',
    '::ffff:192.168.1.20',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '',
    'localhost',
    '8.8.8.8',
    '126.255.255.255',
    '128.0.0.1',
    '11.0.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.169.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '0.0.0.0',
    '2001:db8::1',
    '::ffff:8.8.8.8',
    'fec0::1',
    '64:ff9b::7f00:1',
  ])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('hostLocality', () => {
  it.each(['localhost', 'ollama', 'gpu-box.local'])(
    'is local for %s, whose addresses are all private',
    async (hostname) => {
      expect(await hostLocality(hostname, { resolve })).toBe('local');
    },
  );

  it.each([
    ['ai', 'a name without a dot that resolves to a public address'],
    ['evil.internal', 'a private-looking suffix that resolves to a public address'],
    ['mixed.example', 'one public address among private ones'],
  ])('is external for %s: %s', async (hostname) => {
    expect(await hostLocality(hostname, { resolve })).toBe('external');
  });

  it.each([
    ['empty.example', 'an empty answer'],
    ['unknown.example', 'a name that does not resolve'],
  ])('is unresolved for %s: %s', async (hostname) => {
    expect(await hostLocality(hostname, { resolve })).toBe('unresolved');
  });

  it('judges an IP literal without a lookup', async () => {
    const lookup = vi.fn(resolveEverythingToPublic);
    expect(await hostLocality('192.168.1.20', { resolve: lookup })).toBe('local');
    expect(await hostLocality('[::1]', { resolve: lookup })).toBe('local');
    expect(await hostLocality('8.8.8.8', { resolve: lookup })).toBe('external');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('resolves localhost with the system resolver by default', async () => {
    expect(await hostLocality('localhost')).toBe('local');
  });

  // The lookup never settles, so only the deadline can end the wait.
  it('gives up on a lookup that does not answer before the deadline', async () => {
    const silent: HostResolver = () => new Promise(() => undefined);
    expect(await hostLocality('ollama', { resolve: silent, timeoutMs: 1 })).toBe('unresolved');
  });

  it('waits a few seconds for a lookup by default', () => {
    expect(HOST_LOOKUP_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(HOST_LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('isLocalEndpoint', () => {
  it.each([
    ['ollama', undefined, true],
    ['ollama', 'http://ollama:11434', true],
    ['ollama', 'https://evil.internal', false],
    ['openai-compatible', 'http://localhost:8000/v1', true],
    ['openai-compatible', 'https://mixed.example/v1', false],
    ['openai-compatible', undefined, false],
    ['openai-compatible', 'not a url', false],
    ['anthropic', undefined, false],
    ['anthropic', 'http://127.0.0.1:4000', false],
    ['openai', 'http://localhost:4000/v1', false],
    ['mistral', undefined, false],
    ['gemini', undefined, false],
  ] as const)('%s at %s is local: %j', async (provider, baseUrl, expected) => {
    expect(await isLocalEndpoint(provider, baseUrl, { resolve })).toBe(expected);
  });

  it.each([
    ['ollama', 'http://ollama:11434', 'local'],
    ['ollama', 'https://evil.internal', 'external'],
    ['ollama', 'http://unknown.example:11434', 'unresolved'],
    ['openai-compatible', undefined, 'external'],
    ['openai', 'http://unknown.example/v1', 'external'],
  ] as const)('%s at %s is %s', async (provider, baseUrl, expected) => {
    expect(await endpointLocality(provider, baseUrl, { resolve })).toBe(expected);
  });

  it('does not look up the host of a cloud provider', async () => {
    const lookup = vi.fn(resolve);
    await endpointLocality('openai', 'http://ollama:4000/v1', { resolve: lookup });
    expect(lookup).not.toHaveBeenCalled();
  });

  // Every name resolves to a public address here, so only a URL whose host really is a
  // private IP literal may pass.
  it.each([
    'http://127.0.0.1:8000/v1',
    'http://2130706433/v1',
    'http://0177.0.0.1/v1',
    'http://0x7f.0.0.1/v1',
    'http://0x7f.1/v1',
    'http://１２７.０.０.１/v1',
    'http://[::ffff:127.0.0.1]/v1',
    'http://[::FFFF:7F00:1]/v1',
    'http://127.0.0.1#@evil.example',
    'http://127.0.0.1?@evil.example',
    'http://127.0.0.1\\@evil.example/v1',
    'http://user@10.0.0.5/v1',
  ])('accepts %s, whose host is a private address', async (baseUrl) => {
    expect(
      await isLocalEndpoint('openai-compatible', baseUrl, { resolve: resolveEverythingToPublic }),
    ).toBe(true);
  });

  it.each([
    'http://localhost@evil.example/v1',
    'http://127.0.0.1@evil.example/v1',
    'http://127.0.0.1:80@evil.example/v1',
    'http://127.0.0.1.evil.example/v1',
    'http://evil.example#127.0.0.1',
    'http://evil.example?127.0.0.1',
    'http://evil.example/127.0.0.1',
    'http://evil.example\\@127.0.0.1/v1',
    'http://localhost.evil.example/v1',
    'http://[64:ff9b::7f00:1]/v1',
    'http://[::ffff:8.8.8.8]/v1',
    'http://[2001:db8::1]/v1',
    'http://0.0.0.0:8000/v1',
    'http://134744072/v1',
    'http://0x8.0x8.0x8.0x8/v1',
    'http://127.1.evil.example/v1',
    'http://ⓛocalhost.evil.example/v1',
    'http://internal/v1',
    'http://com./v1',
  ])('refuses %s, whose host is not a private address', async (baseUrl) => {
    expect(
      await isLocalEndpoint('openai-compatible', baseUrl, { resolve: resolveEverythingToPublic }),
    ).toBe(false);
  });
});
