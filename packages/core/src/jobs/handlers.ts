import type { JsonObject } from '../db/columns.ts';
import { DuplicateJobHandlerError } from './errors.ts';
import { type JobKind, parseJobPayload, type TerminalFailureHook } from './kinds.ts';

export interface JobRun {
  /** Aborted when the workers stop past their deadline or when the job lock is lost. */
  readonly signal: AbortSignal;
  /** 1 for the first execution. */
  readonly attempt: number;
}

export interface JobContext<Payload> extends JobRun {
  readonly payload: Payload;
}

export type JobHandler<Payload> = (context: JobContext<Payload>) => Promise<void>;

/** A handler bound to its kind, with the payload type erased behind the schema. */
export interface RegisteredHandler {
  readonly kind: string;
  readonly run: (payload: unknown, run: JobRun) => Promise<void>;
  readonly onTerminalFailure?: TerminalFailureHook;
}

export const handle = <Payload extends JsonObject>(
  kind: JobKind<Payload>,
  handler: JobHandler<Payload>,
): RegisteredHandler => ({
  kind: kind.name,
  run: async (payload, { signal, attempt }) => {
    await handler({ payload: parseJobPayload(kind, payload), signal, attempt });
  },
  ...(kind.onTerminalFailure === undefined ? {} : { onTerminalFailure: kind.onTerminalFailure }),
});

export const createHandlerRegistry = (
  handlers: readonly RegisteredHandler[],
): ReadonlyMap<string, RegisteredHandler> => {
  const duplicate = handlers.find(
    ({ kind }, index) => handlers.findIndex((other) => other.kind === kind) !== index,
  );
  if (duplicate !== undefined) throw new DuplicateJobHandlerError(duplicate.kind);
  return new Map(handlers.map((handler) => [handler.kind, handler]));
};

/** What the workers run: their handlers, and the bounds of some kinds. */
export interface HandlerSet {
  readonly handlers: readonly RegisteredHandler[];
  /** Upper bound per kind, within this process. A kind left out is bound by `concurrency` only. */
  readonly perKindConcurrency?: Readonly<Record<string, number>>;
}

export interface ActiveHandlers {
  readonly registry: ReadonlyMap<string, RegisteredHandler>;
  readonly perKindConcurrency: Readonly<Record<string, number>>;
}

const activate = ({ handlers, perKindConcurrency = {} }: HandlerSet): ActiveHandlers => ({
  registry: createHandlerRegistry(handlers),
  perKindConcurrency,
});

/**
 * Reads the handler set again at every call, and builds its registry once per set: a
 * caller swaps the set to change what the next claimed job runs with.
 */
export const followHandlerSet = (read: () => HandlerSet): (() => ActiveHandlers) => {
  let last: { readonly set: HandlerSet; readonly active: ActiveHandlers } | undefined;
  return () => {
    const set = read();
    if (last?.set !== set) last = { set, active: activate(set) };
    return last.active;
  };
};
