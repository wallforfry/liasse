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

const reply = (response: ModelResponse): void => {
  if (!process.connected) leave();
  // Without the callback a broken channel surfaces as an unhandled EPIPE and a stack trace.
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

export const serveModelRequests = (handlers: ModelHandlers): void => {
  process.on('message', (message) => {
    void answer(modelRequestSchema.parse(message), handlers).then(reply);
  });
  process.on('disconnect', leave);
};
