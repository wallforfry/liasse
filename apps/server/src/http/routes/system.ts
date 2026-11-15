import { healthSchema } from '@liasse/contract';
import { readStats } from '@liasse/core/api';
import { Hono } from 'hono';
import { jsonResponse, operation } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import {
  type HttpMetrics,
  METRICS_CONTENT_TYPE,
  readProcessStats,
  renderMetrics,
} from '../metrics.ts';
import type { RouteDeps } from './deps.ts';

const TAG = 'System';

export interface SystemRouteDeps extends RouteDeps {
  readonly ping: () => Promise<void>;
  readonly metrics: HttpMetrics;
}

export const systemRoutes = ({
  api,
  authenticated,
  ping,
  metrics,
}: SystemRouteDeps): Hono<AppEnv> =>
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
      authenticated,
      async (context) =>
        context.body(
          renderMetrics({
            process: readProcessStats(),
            http: metrics.snapshot(),
            stats: await readStats(api),
          }),
          200,
          { 'Content-Type': METRICS_CONTENT_TYPE },
        ),
    );
