import { loadConfig } from '@liasse/core/config';
import { SYNTHETIC_ENV } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { startupNotices } from './notices.ts';

const configOf = (env: Readonly<Record<string, string>>) =>
  loadConfig({ ...SYNTHETIC_ENV, ...env });

describe('startupNotices', () => {
  it('says nothing of the models when they stay on the private network', async () => {
    const notices = await startupNotices(
      configOf({ LLM_BASE_URL: 'http://models.internal:11434' }),
      { resolve: () => Promise.resolve(['10.0.0.7']) },
    );
    expect(notices.filter((line) => line.startsWith('Warning'))).toEqual([]);
  });

  it('names a self-hosted endpoint whose name did not resolve', async () => {
    const notices = await startupNotices(
      configOf({ LLM_BASE_URL: 'http://models.internal:11434' }),
      { resolve: () => Promise.reject(new Error('ENOTFOUND')) },
    );
    expect(notices).toContain(
      'Warning: document content leaves this machine: document text and page images are ' +
        'sent to ollama at models.internal (the name did not resolve, so the endpoint is ' +
        'treated as external). Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.',
    );
  });

  it('warns of a listener beyond this machine and of signed URLs it cannot be reached at', async () => {
    const notices = await startupNotices(configOf({ HOST: '0.0.0.0' }), {
      resolve: () => Promise.resolve(['127.0.0.1']),
    });
    expect(notices.some((line) => line.startsWith('Notice: the server listens on 0.0.0.0'))).toBe(
      true,
    );
    expect(notices.some((line) => line.startsWith('Notice: HOST is 0.0.0.0 and PUBLIC_URL'))).toBe(
      true,
    );
    const configured = await startupNotices(
      configOf({ HOST: '0.0.0.0', PUBLIC_URL: 'https://liasse.example.com' }),
      { resolve: () => Promise.resolve(['127.0.0.1']) },
    );
    expect(configured.some((line) => line.includes('PUBLIC_URL is not set'))).toBe(false);
  });
});
