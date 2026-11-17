import { MAX_LISTED_MODELS, MAX_MODEL_ID_LENGTH } from '@liasse/contract/domain';
import { ModelListError } from '../errors.ts';
import { isTimeout, networkCode } from './failure.ts';
import { MODEL_CATALOGS, type ModelPurpose } from './model-catalog.ts';
import type { ModelProvider, ProviderEndpoint } from './registry.ts';
import { providerErrorCode } from './safe-text.ts';

export const MODEL_LIST_TIMEOUT_MS = 15_000;
// A provider that keeps answering another page is cut there, not followed for ever.
export const MAX_MODEL_LIST_PAGES = 20;
// eslint-disable-next-line no-control-regex -- control characters are what it refuses
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface ModelListRequest {
  readonly provider: ModelProvider;
  readonly endpoint: ProviderEndpoint;
  readonly purpose: ModelPurpose;
  /** The deadline of the whole listing, every page included. */
  readonly timeoutMs?: number | undefined;
}

const readBody = async (provider: string, response: Response): Promise<unknown> =>
  response.json().catch((error: unknown) => {
    if (isTimeout(error)) throw new ModelListError(provider, 'timeout');
    return undefined;
  });

// Redirects are refused: a key sent in a header of its own, such as `x-api-key`, would
// follow a redirect to another origin.
const fetchPage = async (
  provider: string,
  url: URL,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<unknown> => {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    redirect: 'error',
    signal,
  }).catch((error: unknown) => {
    throw isTimeout(error)
      ? new ModelListError(provider, 'timeout')
      : new ModelListError(provider, 'unreachable', { code: networkCode(error) });
  });
  const body = await readBody(provider, response);
  if (!response.ok) {
    throw new ModelListError(provider, 'rejected', {
      statusCode: response.status,
      code: providerErrorCode(body, response.status),
    });
  }
  return body;
};

const collect = async (
  { provider, endpoint, purpose }: ModelListRequest,
  signal: AbortSignal,
  page: URL,
  depth: number,
): Promise<readonly string[]> => {
  const catalog = MODEL_CATALOGS[provider];
  const body = await fetchPage(provider, page, catalog.headers(endpoint.apiKey), signal);
  const read = catalog.read(body, purpose, page);
  if (read === undefined) throw new ModelListError(provider, 'invalid_answer');
  if (read.next === undefined || depth + 1 >= MAX_MODEL_LIST_PAGES) return read.ids;
  return [
    ...read.ids,
    ...(await collect({ provider, endpoint, purpose }, signal, read.next, depth + 1)),
  ];
};

const usable = (id: string): boolean =>
  id.trim() === id && id.length > 0 && id.length <= MAX_MODEL_ID_LENGTH && !CONTROL.test(id);

/**
 * The ids of the models the provider lists for `purpose`, sorted and without duplicates.
 * Throws `ModelListError` when the provider cannot be reached or does not answer a list.
 */
export const listModels = async (request: ModelListRequest): Promise<readonly string[]> => {
  const signal = AbortSignal.timeout(request.timeoutMs ?? MODEL_LIST_TIMEOUT_MS);
  const first = MODEL_CATALOGS[request.provider].firstPage(request.endpoint.baseUrl);
  const ids = await collect(request, signal, first, 0);
  return [...new Set(ids.filter(usable))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_LISTED_MODELS);
};
