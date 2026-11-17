import { describe, expect, it } from 'vitest';
import {
  type SettingsOverrides,
  resolvedSyntheticSettings,
} from '../../testing/synthetic-settings.ts';
import type { HostResolver } from './locality.ts';
import { describeModelPrivacy } from './privacy.ts';
import { SYNTHETIC_API_KEY } from '../../testing/provider-wire.ts';

// The DNS of the test: a Compose service on a private address and a name that does not
// resolve; any other name is public.
const resolve: HostResolver = (hostname) => {
  if (hostname === 'gpu-box') return Promise.reject(new Error(`ENOTFOUND ${hostname}`));
  return Promise.resolve([hostname === 'ollama' ? '172.18.0.5' : '203.0.113.7']);
};

const privacyOf = (sections: SettingsOverrides) =>
  describeModelPrivacy(resolvedSyntheticSettings(sections), { resolve });

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
        llm: { provider: 'ollama', base_url: 'http://gpu-box:11434' },
        embedding: {
          provider: 'ollama',
          model: 'embedding-model',
          base_url: 'http://gpu-box:11434',
        },
      }),
    ).toEqual({
      external: { text: true, vision: true, embeddings: true },
      unresolvedHosts: ['gpu-box'],
      warning:
        'Warning: document content leaves this machine: document text and page images are sent to ' +
        'ollama at gpu-box (the name did not resolve, so the endpoint is treated as external); ' +
        'text to embed is sent to ' +
        'ollama at gpu-box (the name did not resolve, so the endpoint is treated as external). ' +
        'Choose ollama for the language models and the local embedder in the settings to keep it local.',
    });
  });

  it('says so when the lookup does not answer in time', async () => {
    const silent: HostResolver = () => new Promise(() => undefined);
    const { external, unresolvedHosts } = await describeModelPrivacy(
      resolvedSyntheticSettings({ llm: { provider: 'ollama', base_url: 'http://ollama:11434' } }),
      { resolve: silent, timeoutMs: 1 },
    );
    expect(external.text).toBe(true);
    expect(unresolvedHosts).toEqual(['ollama']);
  });

  it('does not report the unreachable name of a cloud provider as unresolved', async () => {
    const { unresolvedHosts, warning } = await privacyOf({
      llm: { provider: 'openai', api_key: SYNTHETIC_API_KEY, base_url: 'http://gpu-box:4000/v1' },
    });
    expect(unresolvedHosts).toEqual([]);
    expect(warning).toContain('document text and page images are sent to openai at gpu-box.');
  });

  it('warns that text and page images go to a cloud LLM provider', async () => {
    expect(await privacyOf({ llm: { provider: 'anthropic', api_key: SYNTHETIC_API_KEY } })).toEqual(
      {
        external: { text: true, vision: true, embeddings: false },
        unresolvedHosts: [],
        warning:
          'Warning: document content leaves this machine: document text and page images are sent to anthropic. ' +
          'Choose ollama for the language models and the local embedder in the settings to keep it local.',
      },
    );
  });

  it('warns that text to embed goes to a cloud embedding provider', async () => {
    expect(
      await privacyOf({
        embedding: { provider: 'mistral', model: 'embedding-model', api_key: SYNTHETIC_API_KEY },
      }),
    ).toEqual({
      external: { text: false, vision: false, embeddings: true },
      unresolvedHosts: [],
      warning:
        'Warning: document content leaves this machine: text to embed is sent to mistral. ' +
        'Choose ollama for the language models and the local embedder in the settings to keep it local.',
    });
  });

  it('names both destinations on one line', async () => {
    const { external, warning } = await privacyOf({
      llm: {
        provider: 'openai-compatible',
        base_url: 'https://llm.example.com/v1',
        api_key: SYNTHETIC_API_KEY,
      },
      embedding: {
        provider: 'ollama',
        model: 'embedding-model',
        base_url: 'https://ollama.example.com',
      },
    });
    expect(external).toEqual({ text: true, vision: true, embeddings: true });
    expect(warning).toBe(
      'Warning: document content leaves this machine: document text and page images are sent to ' +
        'openai-compatible at llm.example.com; text to embed is sent to ollama at ollama.example.com. ' +
        'Choose ollama for the language models and the local embedder in the settings to keep it local.',
    );
  });

  it('names the host a cloud provider is reached through, and still counts it as external', async () => {
    const { external, warning } = await privacyOf({
      llm: { provider: 'openai', api_key: SYNTHETIC_API_KEY, base_url: 'http://127.0.0.1:4000/v1' },
    });
    expect(external.text).toBe(true);
    expect(warning).toContain('document text and page images are sent to openai at 127.0.0.1.');
  });

  it('treats self-hosted endpoints of the private network as local', async () => {
    expect(
      await privacyOf({
        llm: { provider: 'openai-compatible', base_url: 'http://192.168.1.20:8000/v1' },
        embedding: {
          provider: 'ollama',
          model: 'embedding-model',
          base_url: 'http://ollama:11434',
        },
      }),
    ).toEqual({
      external: { text: false, vision: false, embeddings: false },
      unresolvedHosts: [],
      warning: undefined,
    });
  });
});
