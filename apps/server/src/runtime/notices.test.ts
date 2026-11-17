import { loadConfig } from '@liasse/core/config';
import { resolvedSyntheticSettings, SYNTHETIC_ENV } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { settingsNotices, startupNotices } from './notices.ts';

const configOf = (env: Readonly<Record<string, string>>) =>
  loadConfig({ ...SYNTHETIC_ENV, ...env });

const SELF_HOSTED = resolvedSyntheticSettings({
  llm: { base_url: 'http://models.internal:11434' },
});

describe('settingsNotices', () => {
  it('says nothing of the models when they stay on the private network', async () => {
    const notices = await settingsNotices(configOf({}), SELF_HOSTED, {
      resolve: () => Promise.resolve(['10.0.0.7']),
    });
    expect(notices.filter((line) => line.startsWith('Warning'))).toEqual([]);
  });

  it('names a self-hosted endpoint whose name did not resolve', async () => {
    const notices = await settingsNotices(configOf({}), SELF_HOSTED, {
      resolve: () => Promise.reject(new Error('ENOTFOUND')),
    });
    expect(notices).toContain(
      'Warning: document content leaves this machine: document text and page images are ' +
        'sent to ollama at models.internal (the name did not resolve, so the endpoint is ' +
        'treated as external). Choose ollama for the language models and the local embedder ' +
        'in the settings to keep it local.',
    );
  });

  it('says which optional parts are on', async () => {
    const resolve = { resolve: () => Promise.resolve(['10.0.0.7']) };
    expect(await settingsNotices(configOf({}), SELF_HOSTED, resolve)).toContain(
      'Optional parts: watched folder off, Hindsight off.',
    );
    const both = await settingsNotices(
      configOf({ WATCH_DIR: '/inbox' }),
      resolvedSyntheticSettings({ hindsight: { url: 'http://127.0.0.1:8888' } }),
      resolve,
    );
    expect(both).toContain('Optional parts: watched folder on, Hindsight configured.');
  });
});

describe('startupNotices', () => {
  it('warns of a listener beyond this machine and of signed URLs it cannot be reached at', () => {
    const notices = startupNotices(configOf({ HOST: '0.0.0.0' }));
    expect(notices.some((line) => line.startsWith('Notice: the server listens on 0.0.0.0'))).toBe(
      true,
    );
    expect(notices.some((line) => line.startsWith('Notice: HOST is 0.0.0.0 and PUBLIC_URL'))).toBe(
      true,
    );
    const configured = startupNotices(
      configOf({ HOST: '0.0.0.0', PUBLIC_URL: 'https://liasse.example.com' }),
    );
    expect(configured.some((line) => line.includes('PUBLIC_URL is not set'))).toBe(false);
  });

  it('says MCP takes API keys only when PUBLIC_URL is plain http beyond this machine', () => {
    const plain = startupNotices(configOf({ PUBLIC_URL: 'http://liasse.lan' }));
    expect(plain.some((line) => line.includes('MCP over HTTP accepts API keys only'))).toBe(true);
    const local = startupNotices(configOf({}));
    const secure = startupNotices(configOf({ PUBLIC_URL: 'https://liasse.example.com' }));
    expect([...local, ...secure].some((line) => line.includes('API keys only'))).toBe(false);
  });
});
