import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSyntheticPdf,
  createTestDatabase,
  insertSyntheticDocument,
  SYNTHETIC_ENV,
  TEST_EMBEDDING_DIM,
  type TestDatabase,
  waitUntil,
} from '@liasse/core/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startModelStub } from './model-stub.test-helper.ts';
import { LETTER } from './synthetic-documents.fixture.ts';

const STEP_TIMEOUT_MS = 15_000;
const SERVING = 'Liasse is serving MCP on stdio\n';

// The client side of the stdio transport over a child this test spawned itself, so that
// its exit code can be read; the SDK's own transport spawns the process and hides it.
const childTransport = (child: ChildProcessWithoutNullStreams, errors: Error[]): Transport => {
  const buffer = new ReadBuffer();
  const transport: Transport = {
    start: () => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer.append(chunk);
        try {
          for (
            let message = buffer.readMessage();
            message !== null;
            message = buffer.readMessage()
          ) {
            transport.onmessage?.(message);
          }
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      });
      return Promise.resolve();
    },
    send: (message: JSONRPCMessage) => {
      child.stdin.write(serializeMessage(message));
      return Promise.resolve();
    },
    close: () => {
      child.stdin.end();
      return Promise.resolve();
    },
  };
  return transport;
};

const jsonRpcLine = z.looseObject({ jsonrpc: z.literal('2.0') });

// The lines of stdout that are not a JSON-RPC message: anything else breaks the framing.
const foreignLines = (stdout: string): readonly string[] =>
  stdout
    .split('\n')
    .filter((line) => line !== '')
    .filter((line) => {
      try {
        return !jsonRpcLine.safeParse(JSON.parse(line)).success;
      } catch {
        return true;
      }
    });

const textAnswer = z.object({
  content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]),
});

interface StdioServer {
  readonly client: Client;
  readonly database: TestDatabase;
  /** Calls a tool and reads the JSON of its answer. */
  readonly callTool: (name: string, args?: Readonly<Record<string, unknown>>) => Promise<unknown>;
  /** Ends the input of the server and resolves to its exit code. */
  readonly end: () => Promise<number | null>;
  /** Everything the server wrote on stdout, and what the client could not read of it. */
  readonly stdout: () => string;
  readonly unreadable: () => readonly Error[];
  readonly stderr: () => string;
}

// The real binary and the real entry point, as an MCP client would start it.
const withStdioServer = async (
  env: Readonly<Record<string, string>>,
  use: (server: StdioServer) => Promise<void>,
): Promise<void> => {
  const database = await createTestDatabase({ migrate: false });
  const files = await mkdtemp(join(tmpdir(), 'liasse-stdio-'));
  const child = spawn(
    process.execPath,
    [
      '--conditions=@liasse/source',
      '--experimental-strip-types',
      fileURLToPath(new URL('./main.ts', import.meta.url)),
      '--stdio',
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...SYNTHETIC_ENV,
        PATH: process.env.PATH ?? '',
        DATABASE_URL: database.url,
        STORAGE_PATH: files,
        EMBEDDING_CACHE_DIR: join(files, 'models'),
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  const errors: Error[] = [];
  // Rejected as soon as a whole line of stdout is not the protocol: a stray line can break
  // the client before it answers, and the test must then name the line, not time out.
  const corruption: { reject?: (error: Error) => void } = {};
  const corrupted = new Promise<never>((_, reject) => {
    corruption.reject = reject;
  });
  corrupted.catch(() => undefined);
  const guarded = <Result>(work: Promise<Result>): Promise<Result> =>
    Promise.race([work, corrupted]);
  child.stdout.on('data', (chunk: Buffer) => {
    stdout.push(chunk.toString('utf8'));
    const written = stdout.join('');
    const [foreign] = foreignLines(written.slice(0, written.lastIndexOf('\n') + 1));
    if (foreign !== undefined)
      corruption.reject?.(new Error(`stdout carries more than the protocol: ${foreign}`));
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk));
  const closed = once(child, 'close');
  try {
    await waitUntil(() => {
      if (child.exitCode !== null) throw new Error(`the server exited: ${stderr.join('')}`);
      return stderr.join('').includes(SERVING);
    });
    const client = new Client({ name: 'liasse-test', version: '0.0.0' });
    await guarded(client.connect(childTransport(child, errors)));
    await use({
      client,
      database,
      callTool: async (name, args = {}) => {
        const result = CallToolResultSchema.parse(
          await guarded(client.callTool({ name, arguments: { ...args } })),
        );
        const [{ text }] = textAnswer.parse(result).content;
        const body: unknown = JSON.parse(text);
        return body;
      },
      end: async () => {
        const exited = once(child, 'close', { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
        await client.close();
        const [code] = z.tuple([z.number().nullable(), z.unknown()]).parse(await guarded(exited));
        return code;
      },
      stdout: () => stdout.join(''),
      unreadable: () => errors,
      stderr: () => stderr.join(''),
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await closed;
    }
    await rm(files, { recursive: true, force: true });
    await database.dispose();
  }
};

const rows = z.object({ rows: z.array(z.object({ id: z.string() })) });
const status = z.object({ status: z.string() });

describe('MCP over stdio', () => {
  it(
    'serves the tools on the standard streams and exits with 0 when its input ends',
    async () => {
      await withStdioServer({}, async ({ client, database, callTool, end, ...server }) => {
        const { id: publicId } = await insertSyntheticDocument(database.db, { status: 'indexed' });
        const { id: privateId } = await insertSyntheticDocument(database.db, {
          status: 'indexed',
          private: true,
        });
        expect((await client.listTools()).tools).toHaveLength(16);
        const idsOf = async (args: Readonly<Record<string, unknown>>) =>
          rows.parse(await callTool('query', args)).rows.map(({ id }) => id);
        expect(await idsOf({})).toEqual([publicId]);
        expect((await idsOf({ include_private: true })).toSorted()).toEqual(
          [publicId, privateId].toSorted(),
        );

        expect(await end()).toBe(0);
        expect(foreignLines(server.stdout())).toEqual([]);
        expect(server.unreadable()).toEqual([]);
        expect(server.stderr()).not.toContain('Liasse is listening on');
      });
    },
    4 * STEP_TIMEOUT_MS,
  );

  // The text of a PDF is read in a child process; pdfjs writes its warnings on the stdout
  // of whatever runs it, and here that stdout carries the protocol.
  it(
    'keeps stdout to the protocol while a first PDF goes through extraction',
    async () => {
      const models = await startModelStub(TEST_EMBEDDING_DIM);
      const env = {
        LLM_BASE_URL: models.url,
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'embedding-model',
        EMBEDDING_BASE_URL: models.url,
        EMBEDDING_DIM: String(TEST_EMBEDDING_DIM),
      };
      try {
        await withStdioServer(env, async ({ callTool, end, ...server }) => {
          const pdf = buildSyntheticPdf([{ lines: [...LETTER.lines] }]);
          const { id } = z.object({ id: z.string() }).parse(
            await callTool('ingest', {
              file: Buffer.from(pdf).toString('base64'),
              filename: 'letter.pdf',
            }),
          );
          await waitUntil(
            async () => status.parse(await callTool('get_status', { id })).status === 'indexed',
          );
          expect(models.requests.map(({ path }) => path)).toContain('/v1/chat/completions');

          expect(await end()).toBe(0);
          expect(foreignLines(server.stdout())).toEqual([]);
          expect(server.unreadable()).toEqual([]);
        });
      } finally {
        await models.close();
      }
    },
    4 * STEP_TIMEOUT_MS,
  );
});
