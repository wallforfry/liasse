import type { ProviderEndpoint } from './registry.ts';

const REDACTED = '[redacted]';
const MAX_DETAIL_LENGTH = 300;

const urlSecrets = (baseUrl: string | undefined): readonly string[] => {
  if (baseUrl === undefined || !URL.canParse(baseUrl)) return [];
  const url = new URL(baseUrl);
  return [url.password, ...url.searchParams.values()];
};

// Everything in the endpoint settings that can carry a credential: the API key, the
// password of the base URL and the values of its query string. Longest first, so a secret
// that contains another one is replaced whole.
export const endpointSecrets = ({ apiKey, baseUrl }: ProviderEndpoint): readonly string[] =>
  [apiKey, ...urlSecrets(baseUrl)]
    .filter((secret): secret is string => secret !== undefined && secret !== '')
    .toSorted((left, right) => right.length - left.length);

// Providers echo request headers and URLs in their error messages.
export const redact = (text: string, secrets: readonly string[]): string =>
  secrets
    .reduce((redacted, secret) => redacted.replaceAll(secret, REDACTED), text)
    .slice(0, MAX_DETAIL_LENGTH);
