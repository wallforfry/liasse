import { loadConfig } from '../config/index.ts';
import { StartupError } from '../domain/errors.ts';
import { migrate } from './migrate.ts';

try {
  const config = loadConfig();
  await migrate(config.database.url, { embeddingDim: config.embedding.dimension });
  process.stdout.write('Migrations applied.\n');
} catch (error) {
  if (!(error instanceof StartupError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
