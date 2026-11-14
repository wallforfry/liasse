import { createHash, timingSafeEqual } from 'node:crypto';
import type { FileUrls } from '@liasse/core/api';
import type { MiddlewareHandler } from 'hono';
import type { AppContext, AppEnv } from './env.ts';
import { failure, respondWith } from './errors.ts';

/**
 * One way of proving a request may pass. A route group lists the credentials it accepts;
 * a new one is one more entry in those lists, and no route changes.
 */
export type Credential = (context: AppContext) => boolean | Promise<boolean>;

type Compare = (left: Uint8Array, right: Uint8Array) => boolean;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

const BEARER = /^Bearer +(.+)$/i;

/**
 * `Authorization: Bearer <token>` against the configured tokens. Both sides are hashed,
 * so every comparison is over 32 bytes whatever was presented, and the presented token
 * is compared with every configured one, match or not: the time taken tells neither how
 * many tokens exist, nor their length, nor which one matched.
 */
export const bearerToken = (
  tokens: readonly string[],
  compare: Compare = timingSafeEqual,
): Credential => {
  const expected = tokens.map(digest);
  return (context) => {
    const presented = BEARER.exec(context.req.header('Authorization') ?? '')?.[1];
    const candidate = digest(presented ?? '');
    const matches = expected.map((token) => compare(token, candidate));
    return presented !== undefined && matches.includes(true);
  };
};

/** The `expires` and `signature` of a signed file URL, for the document of the path. */
export const signedFileUrl =
  (fileUrls: FileUrls): Credential =>
  (context) =>
    fileUrls.verify({
      documentId: context.req.param('id') ?? '',
      expires: context.req.query('expires') ?? '',
      signature: context.req.query('signature') ?? '',
    });

const UNAUTHORIZED = failure(401, 'unauthorized', 'A valid Bearer token is required.');

/** Lets a request through when one of the credentials accepts it. All of them are asked. */
export const requireAny =
  (credentials: readonly Credential[]): MiddlewareHandler<AppEnv> =>
  async (context, next) => {
    const verdicts = await Promise.all(credentials.map(async (credential) => credential(context)));
    if (verdicts.includes(true)) return next();
    context.header('WWW-Authenticate', 'Bearer realm="liasse"');
    return respondWith(context, UNAUTHORIZED);
  };
