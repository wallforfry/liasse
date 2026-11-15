import { AUTH_BASE_PATH } from '@liasse/contract';
import type { Auth } from '@liasse/core/auth';
import type { ClientAddressResolver } from '@liasse/core/network';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.ts';
import { withClientAddress } from './client-address.ts';

const AUTH_METHODS = ['GET', 'POST'];
const DISCOVERY_METHODS = ['GET', 'HEAD'];

/**
 * The auth server of better-auth: its endpoints under `/api/auth`, and the OAuth discovery
 * documents of MCP under `/.well-known` (the authorization server and the protected
 * resource), which better-auth answers too. None of them is in the OpenAPI document.
 */
export const authRoutes = (
  auth: Auth,
  timed: MiddlewareHandler<AppEnv>,
  resolveClientAddress: ClientAddressResolver,
): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .on(AUTH_METHODS, `${AUTH_BASE_PATH}/*`, timed, async (context) =>
      auth.handler(withClientAddress(context, resolveClientAddress)),
    )
    .on(DISCOVERY_METHODS, '/.well-known/*', timed, async (context) =>
      auth.handler(withClientAddress(context, resolveClientAddress)),
    );
