import type { FileUrls } from '@liasse/core/api';
import type { MiddlewareHandler } from 'hono';
import type { AppContext, AppEnv } from './env.ts';
import { failure, respondWith } from './errors.ts';

/**
 * One way of proving a request may pass. A route group lists the credentials it accepts;
 * a new one is one more entry in those lists, and no route changes.
 */
export type Credential = (context: AppContext) => boolean | Promise<boolean>;

const BEARER = /^Bearer +(\S+)$/i;

/** The token of `Authorization: Bearer <token>`, or undefined. */
export const bearerTokenOf = (context: AppContext): string | undefined =>
  BEARER.exec(context.req.header('Authorization') ?? '')?.[1];

/** The `expires` and `signature` of a signed file URL, for the document of the path. */
export const signedFileUrl =
  (fileUrls: FileUrls): Credential =>
  (context) =>
    fileUrls.verify({
      documentId: context.req.param('id') ?? '',
      expires: context.req.query('expires') ?? '',
      signature: context.req.query('signature') ?? '',
    });

export const DEFAULT_CHALLENGE = 'Bearer realm="liasse"';

const UNAUTHORIZED = failure('unauthorized', 'A valid Bearer token is required.');

/**
 * Lets a request through when one of the credentials accepts it. All of them are asked. A
 * refused request gets 401 and `challenge` as its `WWW-Authenticate`.
 */
export const requireAny =
  (credentials: readonly Credential[], challenge = DEFAULT_CHALLENGE): MiddlewareHandler<AppEnv> =>
  async (context, next) => {
    const verdicts = await Promise.all(credentials.map(async (credential) => credential(context)));
    if (verdicts.includes(true)) return next();
    context.header('WWW-Authenticate', challenge);
    return respondWith(context, UNAUTHORIZED);
  };
