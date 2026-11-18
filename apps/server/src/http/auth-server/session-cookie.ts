import type { Auth } from '@liasse/core/auth';
import type { Credential } from '../auth.ts';
import { failure, HttpFailure } from '../errors.ts';

const SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

const ORIGIN_REFUSED = failure(
  'origin_refused',
  'A request of the web UI that changes something must come from its own origin.',
);

/**
 * The session cookie of the web UI, for a request without an `Authorization` header: a
 * request that carries one is judged on it alone. A live session lets a GET, HEAD or
 * OPTIONS through; any other method also needs an `Origin` equal to `PUBLIC_URL`, else
 * 403, which a cross-site request cannot forge.
 */
export const sessionCookie =
  (auth: Auth, publicOrigin: string): Credential =>
  async (context) => {
    if (context.req.header('Authorization') !== undefined) return false;
    if (context.req.header('Cookie') === undefined) return false;
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (session === null) return false;
    if (
      !SAFE_METHODS.includes(context.req.method) &&
      context.req.header('Origin') !== publicOrigin
    ) {
      throw new HttpFailure(ORIGIN_REFUSED);
    }
    return true;
  };
