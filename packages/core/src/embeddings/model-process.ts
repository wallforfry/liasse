import { type ChildProcess, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { EmbeddingCacheDirError, LocalModelProcessError } from './errors.ts';
import type { LocalModel, LocalModelLoader, LocalModelSpec } from './local-model.ts';
import { type ModelRequest, type ModelResponse, modelResponseSchema } from './model-protocol.ts';

// Node runs the TypeScript sources directly in development and in tests, and the compiled
// files once built: the child entry has the extension of this very file.
const RUNS_FROM_SOURCE = import.meta.url.endsWith('.ts');
const CHILD_ENTRY = new URL(`./model-child.${RUNS_FROM_SOURCE ? 'ts' : 'js'}`, import.meta.url);
const SOURCE_FLAGS = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];

export interface ModelProcessOptions {
  readonly entry: URL;
  readonly args: readonly string[];
  readonly execArgv?: readonly string[];
}

interface Pending {
  readonly resolve: (response: ModelResponse) => void;
  readonly reject: (error: Error) => void;
}

// Runs a model in a child process and talks to it over the IPC channel. The child's stdout is
// discarded: the server's own stdout may carry a protocol (MCP over stdio).
export const startModelProcess = ({
  entry,
  args,
  execArgv = [],
}: ModelProcessOptions): LocalModel => {
  const child: ChildProcess = fork(entry, [...args], {
    execArgv: [...execArgv],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const pending = new Map<number, Pending>();
  const exited = once(child, 'exit');
  let ended: LocalModelProcessError | undefined;
  let lastId = 0;

  // An idle child never keeps the server alive; a pending request does, until it is answered.
  const holdParent = (hold: boolean): void => {
    if (hold) {
      child.ref();
      child.channel?.ref();
    } else {
      child.unref();
      child.channel?.unref();
    }
  };
  holdParent(false);

  const settle = (id: number): Pending | undefined => {
    const request = pending.get(id);
    pending.delete(id);
    if (pending.size === 0) holdParent(false);
    return request;
  };

  const end = (reason: string): void => {
    ended ??= new LocalModelProcessError(reason);
    for (const id of [...pending.keys()]) settle(id)?.reject(ended);
  };

  child.on('message', (message) => {
    const response = modelResponseSchema.safeParse(message);
    if (response.success) settle(response.data.id)?.resolve(response.data);
    else end('the model process sent a message that is not a response');
  });
  child.once('error', (error) => {
    end(`the model process failed: ${error.message}`);
  });
  child.once('exit', (code, signal) => {
    end(`the model process ended (${signal ?? `exit code ${String(code)}`})`);
  });

  const ask = (kind: ModelRequest['kind'], texts: readonly string[]): Promise<ModelResponse> =>
    new Promise((resolve, reject) => {
      if (ended !== undefined) {
        reject(ended);
        return;
      }
      lastId += 1;
      const id = lastId;
      pending.set(id, { resolve, reject });
      holdParent(true);
      child.send({ id, kind, texts: [...texts] } satisfies ModelRequest, (error) => {
        if (error !== null) end(`the model process is unreachable: ${error.message}`);
      });
    });

  const unexpected = (response: ModelResponse): Error =>
    response.outcome === 'failure'
      ? new Error(response.message)
      : new LocalModelProcessError('the model process answered another kind of request');

  return {
    embed: async (texts) => {
      const response = await ask('embed', texts);
      if (response.outcome !== 'vectors') throw unexpected(response);
      return response.vectors;
    },
    countTokens: async (texts) => {
      const response = await ask('countTokens', texts);
      if (response.outcome !== 'counts') throw unexpected(response);
      return response.counts;
    },
    dispose: async () => {
      end('the model process was stopped');
      if (child.exitCode === null && child.signalCode === null) {
        // Waiting for an unref'd child does not keep the event loop alive.
        child.ref();
        child.kill();
      }
      await exited;
    },
  };
};

export const modelProcessOptions = ({ model, cacheDir }: LocalModelSpec): ModelProcessOptions => ({
  entry: CHILD_ENTRY,
  args: [model, cacheDir],
  execArgv: RUNS_FROM_SOURCE ? SOURCE_FLAGS : [],
});

export const loadModelInChildProcess: LocalModelLoader = ({ model, cacheDir }) => {
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch (error) {
    return Promise.reject(new EmbeddingCacheDirError(error));
  }
  return Promise.resolve(startModelProcess(modelProcessOptions({ model, cacheDir })));
};
