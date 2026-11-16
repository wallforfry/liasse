import { loadConfig } from '@liasse/core/config';
import { StartupError } from '@liasse/core/domain';
import { createRuntime } from './runtime/create-runtime.ts';
import type { Transport } from './runtime/front.ts';
import { installShutdown } from './shutdown.ts';
import { assertSupportedRuntime } from './supported-runtime.ts';

const transportOf = (args: readonly string[]): Transport => {
  if (args.length === 0) return 'http';
  if (args.length === 1 && args[0] === '--stdio') return 'stdio';
  throw new StartupError(
    'Liasse takes no argument, or --stdio to serve MCP on the standard streams.',
  );
};

try {
  assertSupportedRuntime();
  const runtime = await createRuntime(loadConfig(), {
    transport: transportOf(process.argv.slice(2)),
  });
  const shutdown = installShutdown({
    signals: process,
    stop: runtime.stop,
    exit: (code) => {
      process.exit(code);
    },
  });
  void runtime.ended?.then(shutdown);
} catch (error) {
  if (!(error instanceof StartupError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
