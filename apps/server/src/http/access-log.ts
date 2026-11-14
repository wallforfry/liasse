import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { Logger } from '../log.ts';
import type { AppContext, AppEnv } from './env.ts';
import type { HttpMetrics } from './metrics.ts';

const CATCH_ALL = '/*';
export const UNMATCHED_ROUTE = 'unmatched';

// The template of the route that answered. A path nobody registered is named as such:
// it is written by the caller, and may hold anything, a mistyped token included.
const routeOf = (context: AppContext): string => {
  const template = routePath(context, -1);
  return template === CATCH_ALL ? UNMATCHED_ROUTE : template;
};

/**
 * One line per request on stderr and one count in the metrics. Neither holds the path
 * that was asked, its query string (a signed URL carries its signature there), a
 * header or a body.
 */
export const accessLog =
  (
    logger: Logger,
    metrics: HttpMetrics,
    now: () => number = performance.now.bind(performance),
  ): MiddlewareHandler<AppEnv> =>
  async (context, next) => {
    const started = now();
    await next();
    const request = {
      method: context.req.method,
      route: routeOf(context),
      status: context.res.status,
    };
    metrics.observe(request);
    logger.event('request', {
      request_id: context.get('requestId'),
      ...request,
      duration_ms: Math.round(now() - started),
    });
  };
