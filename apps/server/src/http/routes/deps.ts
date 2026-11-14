import type { ApiContext } from '@liasse/core/api';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.ts';

export interface RouteDeps {
  readonly api: ApiContext;
  /** Credentials and the request deadline of the API, decided by the application. */
  readonly authenticated: MiddlewareHandler<AppEnv>;
}
