import { describe, expect, it } from 'vitest';
import { isLocalEndpoint, isPrivateHost } from './locality.ts';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'localhost.',
    'api.localhost',
    '127.0.0.1',
    '127.8.9.10',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.20',
    '169.254.10.10',
    '100.64.0.1',
    '100.127.255.254',
    '[::1]',
    '::1',
    '[fd12:3456:789a::1]',
    '[fe80::1]',
    '[::ffff:192.168.1.20]',
    'ollama',
    'gpu-box.local',
    'host.docker.internal',
    'nas.home.arpa',
  ])('treats %s as private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    '',
    'api.example.com',
    'example.com.',
    'localhost.example.com',
    'notlocal.localx',
    'internal.example.com',
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
    '[2001:db8::1]',
    '[::ffff:8.8.8.8]',
    '[fec0::1]',
  ])('treats %s as public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe('isLocalEndpoint', () => {
  it.each([
    ['ollama', undefined, true],
    ['ollama', 'http://127.0.0.1:11434', true],
    ['ollama', 'http://[::1]:11434', true],
    ['ollama', 'https://ollama.example.com', false],
    ['openai-compatible', 'http://localhost:8000/v1', true],
    ['openai-compatible', 'http://0x7f.1:8000/v1', true],
    ['openai-compatible', 'https://api.example.com/v1', false],
    ['openai-compatible', 'https://localhost.example.com/v1', false],
    ['openai-compatible', 'https://127.0.0.1@api.example.com/v1', false],
    ['openai-compatible', undefined, false],
    ['openai-compatible', 'not a url', false],
    ['anthropic', undefined, false],
    ['anthropic', 'http://127.0.0.1:4000', false],
    ['openai', 'http://localhost:4000/v1', false],
    ['mistral', undefined, false],
    ['gemini', undefined, false],
  ] as const)('%s at %s is local: %j', (provider, baseUrl, expected) => {
    expect(isLocalEndpoint(provider, baseUrl)).toBe(expected);
  });
});
