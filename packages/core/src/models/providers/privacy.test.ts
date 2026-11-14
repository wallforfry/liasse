import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/load.ts';
import { SYNTHETIC_ENV } from '../../testing/synthetic-env.ts';
import type { HostResolver } from './locality.ts';
import { describeModelPrivacy } from './privacy.ts';
import { SYNTHETIC_API_KEY } from '../../testing/provider-wire.ts';

// The DNS of the test: a Compose service on a private address and a name that does not
// resolve; any other name is public.
const resolve: HostResolver = (hostname) => {
  if (hostname === 'gpu-box') return Promise.reject(new Error(`ENOTFOUND ${hostname}`));
  return Promise.resolve([hostname === 'ollama' ? '172.18.0.5' : '203.0.113.7']);
};

const privacyOf = (env: Readonly<Record<string, string>>) =>
  describeModelPrivacy(loadConfig({ ...SYNTHETIC_ENV, ...env }), { resolve });

describe('describeModelPrivacy', () => {
  it('reports nothing external for Ollama and local embeddings', async () => {
    expect(await privacyOf({})).toEqual({
      external: { text: false, vision: false, embeddings: false },
      unresolvedHosts: [],
      warning: undefined,
    });
  });

  it('says that the name of a self-hosted endpoint did not resolve', async () => {
    expect(
      await privacyOf({
        LLM_PROVIDER: 'ollama',
        LLM_BASE_URL: 'http://gpu-box:11434',
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'embedding-model',
        EMBEDDING_BASE_URL: 'http://gpu-box:11434',
      }),
    ).toEqual({
      external: { text: true, vision: true, embeddings: true },
      unresolvedHosts: ['gpu-box'],
      warning:
        'Warning: document content leaves this machine: document text and page images are sent to ' +
        'ollama at gpu-box (the name did not resolve, so the endpoint is treated as external); ' +
        'text to embed is sent to ' +
        'ollama at gpu-box (the name did not resolve, so the endpoint is treated as external). ' +
        'Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.',
    });
  });

  it('says so when the lookup does not answer in time', async () => {
    const silent: HostResolver = () => new Promise(() => undefined);
    const { external, unresolvedHosts } = await describeModelPrivacy(
      loadConfig({ ...SYNTHETIC_ENV, LLM_PROVIDER: 'ollama', LLM_BASE_URL: 'http://ollama:11434' }),
      { resolve: silent, timeoutMs: 1 },
    );
    expect(external.text).toBe(true);
    expect(unresolvedHosts).toEqual(['ollama']);
  });

  it('does not report the unreachable name of a cloud provider as unresolved', async () => {
    const { unresolvedHosts, warning } = await privacyOf({
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: SYNTHETIC_API_KEY,
      LLM_BASE_URL: 'http://gpu-box:4000/v1',
    });
    expect(unresolvedHosts).toEqual([]);
    expect(warning).toContain('document text and page images are sent to openai at gpu-box.');
  });

  it('warns that text and page images go to a cloud LLM provider', async () => {
    expect(await privacyOf({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: SYNTHETIC_API_KEY })).toEqual({
      external: { text: true, vision: true, embeddings: false },
      unresolvedHosts: [],
      warning:
        'Warning: document content leaves this machine: document text and page images are sent to anthropic. ' +
        'Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.',
    });
  });

  it('warns that text to embed goes to a cloud embedding provider', async () => {
    expect(
      await privacyOf({
        EMBEDDING_PROVIDER: 'mistral',
        EMBEDDING_MODEL: 'embedding-model',
        EMBEDDING_API_KEY: SYNTHETIC_API_KEY,
      }),
    ).toEqual({
      external: { text: false, vision: false, embeddings: true },
      unresolvedHosts: [],
      warning:
        'Warning: document content leaves this machine: text to embed is sent to mistral. ' +
        'Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.',
    });
  });

  it('names both destinations on one line', async () => {
    const { external, warning } = await privacyOf({
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'https://llm.example.com/v1',
      LLM_API_KEY: SYNTHETIC_API_KEY,
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'embedding-model',
      EMBEDDING_BASE_URL: 'https://ollama.example.com',
    });
    expect(external).toEqual({ text: true, vision: true, embeddings: true });
    expect(warning).toBe(
      'Warning: document content leaves this machine: document text and page images are sent to ' +
        'openai-compatible at llm.example.com; text to embed is sent to ollama at ollama.example.com. ' +
        'Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.',
    );
  });

  it('names the host a cloud provider is reached through, and still counts it as external', async () => {
    const { external, warning } = await privacyOf({
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: SYNTHETIC_API_KEY,
      LLM_BASE_URL: 'http://127.0.0.1:4000/v1',
    });
    expect(external.text).toBe(true);
    expect(warning).toContain('document text and page images are sent to openai at 127.0.0.1.');
  });

  it('treats self-hosted endpoints of the private network as local', async () => {
    expect(
      await privacyOf({
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: 'http://192.168.1.20:8000/v1',
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'embedding-model',
        EMBEDDING_BASE_URL: 'http://ollama:11434',
      }),
    ).toEqual({
      external: { text: false, vision: false, embeddings: false },
      unresolvedHosts: [],
      warning: undefined,
    });
  });
});
