import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.ts';

export interface RouteDeps {
  /**
   * Credentials, the request deadline of the API and the API context of the settings in
   * force, `context.var.api`, decided by the application.
   */
  readonly authenticated: MiddlewareHandler<AppEnv>;
}
