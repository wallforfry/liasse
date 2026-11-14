import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTestDatabase,
  insertSyntheticDocument,
  SYNTHETIC_ENV,
  waitUntil,
} from '@liasse/core/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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

const textAnswer = z.object({
  content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]),
});
const rows = z.object({ rows: z.array(z.object({ id: z.string() })) });

describe('MCP over stdio', () => {
  it(
    'serves the tools on the standard streams and exits with 0 when its input ends',
    async () => {
      const database = await createTestDatabase({ migrate: false });
      const files = await mkdtemp(join(tmpdir(), 'liasse-stdio-'));
      // The real binary and the real entry point, as an MCP client would start it.
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
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      const stderr: string[] = [];
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk));
      const closed = once(child, 'close');
      const errors: Error[] = [];
      try {
        await waitUntil(() => {
          if (child.exitCode !== null) throw new Error(`the server exited: ${stderr.join('')}`);
          return stderr.join('').includes(SERVING);
        });
        const { id: publicId } = await insertSyntheticDocument(database.db, { status: 'indexed' });
        const { id: privateId } = await insertSyntheticDocument(database.db, {
          status: 'indexed',
          private: true,
        });

        const client = new Client({ name: 'liasse-test', version: '0.0.0' });
        await client.connect(childTransport(child, errors));
        expect((await client.listTools()).tools).toHaveLength(14);
        const idsOf = async (args: Readonly<Record<string, unknown>>) => {
          const result = CallToolResultSchema.parse(
            await client.callTool({ name: 'query', arguments: { ...args } }),
          );
          const [{ text }] = textAnswer.parse(result).content;
          return rows.parse(JSON.parse(text)).rows.map(({ id }) => id);
        };
        expect(await idsOf({})).toEqual([publicId]);
        expect((await idsOf({ include_private: true })).toSorted()).toEqual(
          [publicId, privateId].toSorted(),
        );

        const exited = once(child, 'close', { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
        await client.close();
        const [code] = z.tuple([z.number().nullable(), z.unknown()]).parse(await exited);
        expect(code).toBe(0);
        // Every byte of stdout was a message of the protocol.
        expect(errors).toEqual([]);
        expect(stderr.join('')).not.toContain('Liasse is listening on');
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await closed;
        }
        await rm(files, { recursive: true, force: true });
        await database.dispose();
      }
    },
    4 * STEP_TIMEOUT_MS,
  );
});
