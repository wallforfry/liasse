// The AI SDK costs about 13 MB of resident memory once imported, so it is loaded by the
// first model call rather than with the module graph.
export const loadSdk = () => import('ai');

export type Sdk = Awaited<ReturnType<typeof loadSdk>>;

export const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let loaded: Promise<T> | undefined;
  return () => (loaded ??= load());
};
