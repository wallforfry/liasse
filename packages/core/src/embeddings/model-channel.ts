import { type ModelRequest, modelRequestSchema, type ModelResponse } from './model-protocol.ts';

// The side of the IPC channel that lives in the model process.

export interface ModelHandlers {
  readonly embed: (texts: readonly string[]) => Promise<number[][]>;
  readonly countTokens: (texts: readonly string[]) => Promise<number[]>;
}

// A failure that says nothing about the request: the same request can succeed later.
export class RetryableModelFailure extends Error {
  override readonly name = 'RetryableModelFailure';
}

// Loads once and shares the result, but forgets a load that failed: the next caller tries
// again, since what made it fail (a download, a missing file) can have been repaired.
export const loadOnceUntilLoaded = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let loading: Promise<T> | undefined;
  return () => {
    loading ??= load().catch((error: unknown) => {
      loading = undefined;
      throw new RetryableModelFailure(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    });
    return loading;
  };
};

// The server process is gone, or going: nothing is left to answer to, and nothing to say.
const leave = (): never => process.exit(0);

// Node reports a message that could not be sent to the callback when there is one, and as an
// `error` event on the process otherwise, which nothing handles: a stack trace, then exit 1.
const reply = (response: ModelResponse): void => {
  process.send?.(response, (error) => {
    if (error !== null) leave();
  });
};

const answer = async (
  { id, kind, texts }: ModelRequest,
  handlers: ModelHandlers,
): Promise<ModelResponse> => {
  try {
    return kind === 'embed'
      ? { id, outcome: 'vectors', vectors: await handlers.embed(texts) }
      : { id, outcome: 'counts', counts: await handlers.countTokens(texts) };
  } catch (error) {
    return {
      id,
      outcome: 'failure',
      message: error instanceof Error ? error.message : String(error),
      retryable: error instanceof RetryableModelFailure,
    };
  }
};

// One request at a time, in the order they arrive. ONNX Runtime runs concurrent batches
// side by side, and the memory of the process grows with every batch in flight; the
// server sends one batch per caller, so the queue never holds more than its callers.
export const serveModelRequests = (handlers: ModelHandlers): void => {
  let queue = Promise.resolve();
  process.on('message', (message) => {
    const request = modelRequestSchema.parse(message);
    queue = queue.then(async () => {
      reply(await answer(request, handlers));
    });
  });
  // Whatever the model is busy with, there is nobody left to hear the answer.
  process.on('disconnect', leave);
};
