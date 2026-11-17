import { healthSchema } from '@liasse/contract';
import { readStats } from '@liasse/core/api';
import type { Database } from '@liasse/core/db';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { jsonResponse, operation } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import {
  type HttpMetrics,
  METRICS_CONTENT_TYPE,
  readProcessStats,
  renderMetrics,
} from '../metrics.ts';

const TAG = 'System';

export interface SystemRouteDeps {
  /** Credentials and a deadline only: the metrics answer whether or not settings are saved. */
  readonly credentialed: MiddlewareHandler<AppEnv>;
  readonly db: Database;
  readonly ping: () => Promise<void>;
  readonly metrics: HttpMetrics;
}

export const systemRoutes = ({ credentialed, db, ping, metrics }: SystemRouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .get(
      '/health',
      // Open to anyone who reaches the listener, so it says one thing: whether the
      // database answers. No version, no configuration, no count.
      operation({
        summary: 'Liveness',
        tag: TAG,
        credentials: [],
        responses: {
          200: jsonResponse('The database answers.', healthSchema),
          503: jsonResponse('The database does not answer.', healthSchema),
        },
      }),
      async (context) => {
        try {
          await ping();
          return context.json({ status: 'ok' });
        } catch {
          return context.json({ status: 'unavailable' }, 503);
        }
      },
    )
    .get(
      '/metrics',
      operation({
        summary: 'Prometheus metrics',
        tag: TAG,
        responses: {
          200: {
            description: 'The text exposition format.',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      }),
      credentialed,
      async (context) =>
        context.body(
          renderMetrics({
            process: readProcessStats(),
            http: metrics.snapshot(),
            stats: await readStats({ db }),
          }),
          200,
          { 'Content-Type': METRICS_CONTENT_TYPE },
        ),
    );
