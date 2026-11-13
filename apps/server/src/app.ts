import type { DatabaseHandle } from '@liasse/core/db';
import { Hono } from 'hono';

export interface AppDependencies {
  readonly database: Pick<DatabaseHandle, 'db' | 'ping'>;
}

export const createApp = ({ database }: AppDependencies): Hono => {
  const app = new Hono();

  app.get('/health', async (context) => {
    try {
      await database.ping();
      return context.json({ status: 'ok' });
    } catch {
      return context.json({ status: 'unavailable' }, 503);
    }
  });

  return app;
};
