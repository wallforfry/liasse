import { type ChildProcess, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import {
  EmbeddingCacheDirError,
  LocalModelProcessError,
  LocalModelRequestError,
  LocalModelTimeoutError,
} from './errors.ts';
import type { LocalModel, LocalModelLoader, LocalModelSpec } from './local-model.ts';
import { type ModelRequest, type ModelResponse, modelResponseSchema } from './model-protocol.ts';

// Node runs the TypeScript sources directly in development and in tests, and the compiled
// files once built: the child entry has the extension of this very file.
const RUNS_FROM_SOURCE = import.meta.url.endsWith('.ts');
const CHILD_ENTRY = new URL(`./model-child.${RUNS_FROM_SOURCE ? 'ts' : 'js'}`, import.meta.url);
const SOURCE_FLAGS = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];

// Long enough for the first request to download the model (about 120 MB) and run a batch;
// past it the process is taken for stuck.
export const MODEL_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export interface ModelProcessOptions {
  readonly entry: URL;
  readonly args: readonly string[];
  readonly execArgv?: readonly string[];
  readonly requestTimeoutMs?: number;
}

interface Pending {
  readonly resolve: (response: ModelResponse) => void;
  readonly reject: (error: Error) => void;
  readonly deadline: NodeJS.Timeout;
}

// Runs a model in a child process and talks to it over the IPC channel. The child's stdout is
// discarded: the server's own stdout may carry a protocol (MCP over stdio).
export const startModelProcess = ({
  entry,
  args,
  execArgv = [],
  requestTimeoutMs = MODEL_REQUEST_TIMEOUT_MS,
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
    clearTimeout(request?.deadline);
    pending.delete(id);
    if (pending.size === 0) holdParent(false);
    return request;
  };

  const end = (failure: LocalModelProcessError): void => {
    ended ??= failure;
    for (const id of [...pending.keys()]) settle(id)?.reject(ended);
  };

  const kill = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    // Waiting for an unref'd child does not keep the event loop alive.
    child.ref();
    child.kill();
  };

  // A process that does not answer would hold its request, the server and the idle stop for
  // ever: it is ended instead, which rejects everything it was asked.
  const giveUp = (): void => {
    end(
      new LocalModelTimeoutError(
        `the model process did not answer within ${String(requestTimeoutMs)} ms and was ended`,
      ),
    );
    kill();
  };

  child.on('message', (message) => {
    const response = modelResponseSchema.safeParse(message);
    if (response.success) settle(response.data.id)?.resolve(response.data);
    else {
      end(new LocalModelProcessError('the model process sent a message that is not a response'));
    }
  });
  child.once('error', (error) => {
    end(new LocalModelProcessError(`the model process failed: ${error.message}`));
  });
  child.once('exit', (code, signal) => {
    end(
      new LocalModelProcessError(
        `the model process ended (${signal ?? `exit code ${String(code)}`})`,
      ),
    );
  });

  const ask = (kind: ModelRequest['kind'], texts: readonly string[]): Promise<ModelResponse> =>
    new Promise((resolve, reject) => {
      if (ended !== undefined) {
        reject(ended);
        return;
      }
      lastId += 1;
      const id = lastId;
      pending.set(id, { resolve, reject, deadline: setTimeout(giveUp, requestTimeoutMs) });
      holdParent(true);
      child.send({ id, kind, texts: [...texts] } satisfies ModelRequest, (error) => {
        if (error !== null) {
          end(new LocalModelProcessError(`the model process is unreachable: ${error.message}`));
        }
      });
    });

  const unexpected = (response: ModelResponse): Error =>
    response.outcome === 'failure'
      ? new LocalModelRequestError(response.message, response.retryable)
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
      end(new LocalModelProcessError('the model process was stopped'));
      kill();
      await exited;
    },
  };
};

export const modelProcessOptions = ({
  model,
  cacheDir,
  requestTimeoutMs,
}: LocalModelSpec): ModelProcessOptions => ({
  entry: CHILD_ENTRY,
  args: [model, cacheDir],
  execArgv: RUNS_FROM_SOURCE ? SOURCE_FLAGS : [],
  ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
});

export const loadModelInChildProcess: LocalModelLoader = ({ model, cacheDir }) => {
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch (error) {
    return Promise.reject(new EmbeddingCacheDirError(error));
  }
  return Promise.resolve(startModelProcess(modelProcessOptions({ model, cacheDir })));
};
