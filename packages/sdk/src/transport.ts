import { errorBodySchema } from '@liasse/core/contract';
import type { z } from 'zod';
import { LiasseApiError, LiasseResponseError } from './errors.ts';

export const DEFAULT_TIMEOUT_MS = 60_000;

export interface ClientOptions {
  /** Origin of the server, with the path prefix of a reverse proxy if any. */
  readonly baseUrl: string | URL;
  /** One of the `API_TOKENS` of the server. */
  readonly token: string;
  /** The global `fetch` unless given. */
  readonly fetch?: typeof fetch;
  /** Bounds each call, reading the answer included. */
  readonly timeoutMs?: number;
}

type QueryValue = string | number | boolean | readonly string[] | undefined;
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface RequestSpec {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** From the root of the API, starting with `/`. */
  readonly path: string;
  readonly query?: QueryParams;
  readonly json?: unknown;
  readonly form?: FormData;
  /** Statuses besides 2xx answered with the body of the route rather than an error. */
  readonly accept?: readonly number[];
}

export type Send = (spec: RequestSpec) => Promise<Response>;

// A query string carries text: a list travels comma-separated, as the server reads it.
const queryText = (value: Exclude<QueryValue, undefined>): string =>
  typeof value === 'object' ? value.join(',') : String(value);

const searchOf = (query: QueryParams): string =>
  new URLSearchParams(
    Object.entries(query).flatMap(([name, value]): [string, string][] =>
      value === undefined ? [] : [[name, queryText(value)]],
    ),
  ).toString();

// Relative paths resolve under the last `/` of the base: without one, a path prefix
// would be dropped.
const rootOf = (baseUrl: string | URL): URL => {
  const url = new URL(baseUrl);
  return url.pathname.endsWith('/') ? url : new URL(`${url.pathname}/`, url);
};

const NOT_JSON = Symbol('not JSON');

const jsonOf = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
};

const failureOf = async (response: Response): Promise<Error> => {
  const parsed = errorBodySchema.safeParse(await jsonOf(response));
  return parsed.success
    ? new LiasseApiError(response.status, parsed.data)
    : new LiasseResponseError(
        response.status,
        `HTTP ${String(response.status)} without the error body of the API.`,
      );
};

/** Parses a JSON answer with the schema of its route. */
export const parseJson = async <Schema extends z.ZodType>(
  schema: Schema,
  response: Response,
): Promise<z.output<Schema>> => {
  const body = await jsonOf(response);
  if (body === NOT_JSON) throw new LiasseResponseError(response.status, 'The answer is not JSON.');
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new LiasseResponseError(
    response.status,
    'The answer does not follow the contract of the API.',
    parsed.error,
  );
};

interface Body {
  readonly body?: FormData | string;
  /** Unset for a form: fetch writes it with the boundary. */
  readonly headers?: Readonly<Record<string, string>>;
}

const bodyOf = ({ json, form }: RequestSpec): Body => {
  if (form !== undefined) return { body: form };
  if (json === undefined) return {};
  return { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } };
};

/**
 * Sends one request with the token, under the timeout. Rejects with `LiasseApiError` for
 * a refusal of the API, `LiasseResponseError` for an answer outside the contract; a
 * network failure or the timeout rejects as `fetch` does.
 */
export const createSend = ({
  baseUrl,
  token,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ClientOptions): Send => {
  const root = rootOf(baseUrl);
  return async (spec) => {
    const url = new URL(spec.path.replace(/^\//, ''), root);
    url.search = searchOf(spec.query ?? {});
    const { body, headers } = bodyOf(spec);
    const response = await fetchImpl(url, {
      method: spec.method ?? 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...headers, Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body }),
    });
    if (response.ok || spec.accept?.includes(response.status) === true) return response;
    throw await failureOf(response);
  };
};
