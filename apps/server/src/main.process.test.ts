import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, SYNTHETIC_ENV } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';

const STEP_TIMEOUT_MS = 15_000;

const freePort = async (): Promise<number> => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  await once(probe, 'close');
  if (address === null || typeof address === 'string') throw new Error('no TCP port was assigned');
  return address.port;
};

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

interface RunningServer {
  readonly child: ChildProcess;
  readonly port: number;
  readonly firstLine: readonly unknown[];
  readonly stderr: () => string;
}

// The real binary and the real entry point: a shim would not prove the signal wiring.
const withServer = async (
  env: Readonly<Record<string, string>>,
  use: (server: RunningServer) => Promise<void>,
): Promise<void> => {
  const database = await createTestDatabase({ migrate: false });
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      '--conditions=@liasse/source',
      '--experimental-strip-types',
      fileURLToPath(new URL('./main.ts', import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...SYNTHETIC_ENV,
        ...env,
        DATABASE_URL: database.url,
        HOST: '127.0.0.1',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const stderr: string[] = [];
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk));
  try {
    const firstLine: readonly unknown[] = await Promise.race([
      once(createInterface(child.stdout), 'line', {
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      }),
      once(child, 'exit').then(() => {
        throw new Error(`the server exited before listening: ${stderr.join('')}`);
      }),
    ]);
    await use({ child, port, firstLine, stderr: () => stderr.join('') });
  } finally {
    if (!hasExited(child)) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    await database.dispose();
  }
};

describe('server process', () => {
  it(
    'serves /health, then exits with code 0 on SIGTERM',
    async () => {
      await withServer({}, async ({ child, port, firstLine }) => {
        expect(firstLine).toEqual([`Liasse is listening on http://127.0.0.1:${String(port)}`]);

        const response = await fetch(`http://127.0.0.1:${String(port)}/health`, {
          signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });

        const exited = once(child, 'exit', { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
        child.kill('SIGTERM');
        expect(await exited).toEqual([0, null]);
      });
    },
    4 * STEP_TIMEOUT_MS,
  );

  it(
    'warns on stderr when a cloud model provider is configured',
    async () => {
      const apiKey = 'synthetic-llm-key-7c1e';
      await withServer({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: apiKey }, async (server) => {
        // `close` comes after the output streams have ended, so stderr is complete.
        const closed = once(server.child, 'close', {
          signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        });
        server.child.kill('SIGTERM');
        await closed;
        expect(server.stderr()).toContain(
          'Warning: document content leaves this machine: ' +
            'document text and page images are sent to anthropic. ' +
            'Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.\n',
        );
        expect(server.stderr()).not.toContain(apiKey);
      });
    },
    4 * STEP_TIMEOUT_MS,
  );
});
