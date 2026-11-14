import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { every } from 'hono/combine';
import { HTTPException } from 'hono/http-exception';
import { timeout } from 'hono/timeout';
import type { AppEnv } from './env.ts';
import { failure, HttpFailure } from './errors.ts';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Always minted here: an id taken from the request would let a caller write into the
// logs and into a response header.
export const requestId: MiddlewareHandler<AppEnv> = async (context, next) => {
  const id = randomUUID();
  context.set('requestId', id);
  await next();
  // Set on the final response: a route that builds its own (the file stream) would
  // otherwise drop a header set before it ran.
  context.res.headers.set(REQUEST_ID_HEADER, id);
};

// For an API that answers JSON to programs: nothing may be framed, sniffed, cached or
// loaded from elsewhere. The file route replaces the policy with `sandbox`.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
} as const;

export const securityHeaders: MiddlewareHandler<AppEnv> = async (context, next) => {
  await next();
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => {
    if (!context.res.headers.has(name)) context.res.headers.set(name, value);
  });
};

/**
 * Answers 504 once the time is up. The work behind the request is not interrupted: a
 * query is bounded by its own statement timeout, an upload by the size limit.
 */
export const requestTimeout = (milliseconds: number): MiddlewareHandler<AppEnv> =>
  timeout(milliseconds, new HTTPException(504));

const mediaTypeOf = (header: string | undefined): string =>
  (header ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';

/** Refuses a request whose body is not declared as one of the given media types. */
export const requireMediaType =
  (accepted: readonly string[]): MiddlewareHandler<AppEnv> =>
  async (context, next) => {
    if (!accepted.includes(mediaTypeOf(context.req.header('Content-Type')))) {
      throw new HttpFailure(
        failure(415, 'unsupported_media_type', `Expected a body of type ${accepted.join(' or ')}.`),
      );
    }
    await next();
  };

export const MAX_JSON_BODY_BYTES = 64 * 1024;
export const MAX_JSON_DEPTH = 32;

// Brackets are counted outside strings, in one pass, before anything parses the text:
// neither `JSON.parse` nor a schema is ever handed a document nested without end.
const exceedsDepth = (text: string, maxDepth: number): boolean => {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (character === '\\') index += 1;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > maxDepth) return true;
    } else if (character === '}' || character === ']') depth -= 1;
  }
  return false;
};

export const jsonDepth: MiddlewareHandler<AppEnv> = async (context, next) => {
  // Hono keeps the body it read: the validator that follows parses this same text.
  if (exceedsDepth(await context.req.text(), MAX_JSON_DEPTH)) {
    throw new HttpFailure(
      failure(
        400,
        'invalid_body',
        `The JSON body is nested deeper than ${String(MAX_JSON_DEPTH)}.`,
      ),
    );
  }
  await next();
};

const bodyTooLarge = (): never => {
  throw new HTTPException(413);
};

/** What every route that reads a JSON body goes through, in this order. */
export const jsonBody: MiddlewareHandler<AppEnv> = every(
  requireMediaType(['application/json']),
  bodyLimit({ maxSize: MAX_JSON_BODY_BYTES, onError: bodyTooLarge }),
  jsonDepth,
);
