import { errorBodySchema } from '@liasse/contract';
import { z } from 'zod';
import { LiasseApiError, LiasseResponseError } from './errors.ts';

export const DEFAULT_TIMEOUT_MS = 60_000;

interface ConnectionOptions {
  /** Origin of the server, with the path prefix of a reverse proxy if any. */
  readonly baseUrl: string | URL;
  /** The global `fetch` unless given. */
  readonly fetch?: typeof fetch;
  /** Bounds each call, reading the answer included. */
  readonly timeoutMs?: number;
}

export type ClientOptions = ConnectionOptions &
  (
    | {
        /** An API key, created in the web UI. */
        readonly token: string;
        readonly session?: never;
      }
    | {
        /**
         * The session of the web UI, for a page served by the server itself: the browser
         * sends the session cookie, and the `Origin` the server checks on every request
         * that changes something.
         */
        readonly session: true;
        readonly token?: never;
      }
  );

type QueryValue = string | number | boolean | readonly string[] | undefined;
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface RequestSpec {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** From the root of the API, starting with `/`. */
  readonly path: string;
  readonly query?: QueryParams;
  readonly json?: unknown;
  readonly form?: FormData;
  /** Statuses besides 2xx answered with the body of the route rather than an error. */
  readonly accept?: readonly number[];
  /** A route that answers within a bound of its own raises the timeout of the client to it. */
  readonly minimumTimeoutMs?: number;
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

// The error body of the API with any code: a server of another version may answer one
// this SDK does not list.
const anyCodeBodySchema = z.object({
  error: errorBodySchema.shape.error.extend({ code: z.string() }),
});

const unknownBodyOf = (status: number, body: unknown, cause: z.ZodError): Error => {
  const known = anyCodeBodySchema.safeParse(body);
  const message = known.success
    ? `HTTP ${String(status)} with the code "${known.data.error.code}" (request ` +
      `${known.data.error.request_id}), which this SDK does not know.`
    : `HTTP ${String(status)} without the error body of the API.`;
  return new LiasseResponseError(status, message, cause);
};

const failureOf = async (response: Response): Promise<Error> => {
  const body = await jsonOf(response);
  if (body === NOT_JSON) {
    return new LiasseResponseError(
      response.status,
      `HTTP ${String(response.status)} without the error body of the API.`,
    );
  }
  const parsed = errorBodySchema.safeParse(body);
  return parsed.success
    ? new LiasseApiError(response.status, parsed.data)
    : unknownBodyOf(response.status, body, parsed.error);
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

interface Credentials {
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials?: RequestInit['credentials'];
}

const credentialsOf = (options: ClientOptions): Credentials =>
  options.session === true
    ? { headers: {}, credentials: 'same-origin' }
    : { headers: { Authorization: `Bearer ${options.token}` } };

/**
 * Sends one request with the token or the session, under the timeout. Rejects with
 * `LiasseApiError` for a refusal of the API, `LiasseResponseError` for an answer outside
 * the contract; a network failure or the timeout rejects as `fetch` does.
 */
export const createSend = (options: ClientOptions): Send => {
  const { fetch: fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const root = rootOf(options.baseUrl);
  return async (spec) => {
    const url = new URL(spec.path.replace(/^\//, ''), root);
    url.search = searchOf(spec.query ?? {});
    const method = spec.method ?? 'GET';
    const { body, headers } = bodyOf(spec);
    const credentials = credentialsOf(options);
    const response = await fetchImpl(url, {
      method,
      signal: AbortSignal.timeout(Math.max(timeoutMs, spec.minimumTimeoutMs ?? 0)),
      headers: { ...headers, ...credentials.headers },
      ...(credentials.credentials === undefined ? {} : { credentials: credentials.credentials }),
      ...(body === undefined ? {} : { body }),
    });
    if (response.ok || spec.accept?.includes(response.status) === true) return response;
    throw await failureOf(response);
  };
};
