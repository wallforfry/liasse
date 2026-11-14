import { loadConfig } from '@liasse/core/config';
import { StartupError } from '@liasse/core/domain';
import { createRuntime } from './runtime/create-runtime.ts';
import { installShutdown } from './shutdown.ts';

try {
  const runtime = await createRuntime(loadConfig());
  installShutdown({
    signals: process,
    stop: runtime.stop,
    exit: (code) => {
      process.exit(code);
    },
  });
} catch (error) {
  if (!(error instanceof StartupError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
