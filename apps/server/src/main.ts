import { serve } from '@hono/node-server';
import { loadConfig } from '@liasse/core/config';
import { createDb, migrate } from '@liasse/core/db';
import { StartupError } from '@liasse/core/domain';
import { createApp } from './app.ts';

const start = async (): Promise<void> => {
  const config = loadConfig();
  await migrate(config.database.url, { embeddingDim: config.embedding.dimension });
  const database = createDb(config.database.url);
  const server = serve(
    {
      fetch: createApp({ database }).fetch,
      hostname: config.server.host,
      port: config.server.port,
    },
    ({ address, port }) => {
      process.stdout.write(`Liasse is listening on http://${address}:${String(port)}\n`);
    },
  );
  const shutdown = (): void => {
    server.close(() => {
      void database.close();
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

try {
  await start();
} catch (error) {
  if (!(error instanceof StartupError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
