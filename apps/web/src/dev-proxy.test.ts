import { AUTH_BASE_PATH } from '@liasse/contract';
import { createLiasseClient } from '@liasse/sdk';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config.ts';

const DEV_ORIGIN = 'http://localhost:5173';

// The rule of Vite's proxy: a key that starts with `^` is a regular expression, any other
// a prefix of the path, query included.
const proxied = (path: string): boolean =>
  Object.keys(viteConfig.server?.proxy ?? {}).some((key) =>
    key.startsWith('^') ? new RegExp(key).test(path) : path.startsWith(key),
  );

const urlOf = (input: RequestInfo | URL): URL =>
  new URL(input instanceof Request ? input.url : input);

const recordingClient = (paths: string[]) =>
  createLiasseClient({
    baseUrl: DEV_ORIGIN,
    session: true,
    fetch: async (input) => {
      const url = urlOf(input);
      paths.push(`${url.pathname}${url.search}`);
      return Promise.reject(new Error('recorded'));
    },
  });

// An id or options for most methods, a file for the upload: a call whose arguments do not
// fit throws before sending, and records nothing.
const ARGUMENT_SETS: readonly (readonly unknown[])[] = [
  ['syn_01', {}],
  [{ file: new Blob(['synthetic']), filename: 'synthetic.pdf' }],
];

const pathsSentBy = async (name: string): Promise<readonly string[]> => {
  const paths: string[] = [];
  for (const argumentSet of ARGUMENT_SETS) {
    const client = recordingClient(paths);
    const method: unknown = Reflect.get(client, name);
    if (typeof method !== 'function') return paths;
    try {
      await Reflect.apply(method, client, argumentSet);
    } catch {
      // Every call that sends fails on the recording fetch.
    }
  }
  return paths;
};

// Every method of the SDK, with the paths it sends.
const sdkPaths = async (): Promise<ReadonlyMap<string, readonly string[]>> => {
  const names = Object.keys(recordingClient([]));
  const sent = await Promise.all(names.map(pathsSentBy));
  return new Map(names.map((name, index) => [name, sent[index] ?? []]));
};

describe('the proxy of the Vite dev server', () => {
  it('forwards every path the SDK calls to the server', async () => {
    const sent = [...(await sdkPaths())];

    expect(sent.filter(([, paths]) => paths.length === 0).map(([name]) => name)).toEqual([]);
    expect(sent.flatMap(([, paths]) => paths).filter((path) => !proxied(path))).toEqual([]);
  });

  it('forwards the auth server and its discovery documents', () => {
    expect(proxied(`${AUTH_BASE_PATH}/get-session`)).toBe(true);
    expect(proxied('/.well-known/oauth-authorization-server')).toBe(true);
  });

  it('keeps the UI and the paths of Vite itself on the dev server', () => {
    const base = viteConfig.base ?? '/';
    const local = ['', '?page=1', 'documents', '@vite/client', '@fs/src/main.tsx'].map(
      (rest) => `${base}${rest}`,
    );

    expect(local.filter(proxied)).toEqual([]);
    expect(proxied(base.slice(0, -1))).toBe(false);
    expect(proxied(`${base.slice(0, -1)}?page=1`)).toBe(false);
  });
});
