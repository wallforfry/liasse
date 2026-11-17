import { type Execution, type ExecutionDeps, executeJob } from './execution.ts';
import type { ActiveHandlers } from './handlers.ts';
import { type ClaimedJob, claimJob } from './store.ts';
import type { WakeSignal } from './wake-signal.ts';

export interface DispatcherOptions {
  readonly execution: ExecutionDeps;
  /** Read for every claim: its kinds and bounds decide what may be claimed. */
  readonly handlers: () => ActiveHandlers;
  readonly concurrency: number;
  readonly pollIntervalMs: number;
  readonly maxPollIntervalMs: number;
  readonly wake: WakeSignal;
}

export interface Dispatcher {
  /** Stops claiming. Resolves once the claim in progress, if any, has started its job. */
  readonly halt: () => Promise<void>;
  readonly inFlight: () => readonly Execution[];
}

// One loop claims for every slot of the process, which is what lets it count the
// running jobs of each kind before it asks for more.
export const startDispatcher = ({
  execution,
  handlers,
  concurrency,
  pollIntervalMs,
  maxPollIntervalMs,
  wake,
}: DispatcherOptions): Dispatcher => {
  const running = new Map<string, Execution>();
  let halted = false;

  const runningOfKind = (kind: string): number =>
    [...running.values()].filter(({ job }) => job.kind === kind).length;

  const claimableKinds = ({ registry, perKindConcurrency }: ActiveHandlers): readonly string[] =>
    running.size >= concurrency
      ? []
      : [...registry.keys()].filter(
          (kind) => runningOfKind(kind) < (perKindConcurrency[kind] ?? concurrency),
        );

  const claim = async (): Promise<ClaimedJob | undefined> => {
    try {
      return await claimJob(execution.db, claimableKinds(handlers()));
    } catch (error) {
      execution.onError(error);
      return undefined;
    }
  };

  // The handler is chosen by the execution, once the job is claimed: the set read for the
  // claim may have been replaced while the claim waited for a connection.
  const start = (job: ClaimedJob): void => {
    const started = executeJob(execution, job);
    // A job this process lost and claimed again runs twice at once for a while: the
    // attempt tells the two executions apart, the job id alone would merge them.
    const token = `${job.id}:${String(job.attempt)}`;
    running.set(token, started);
    void started.done.then(() => {
      running.delete(token);
      wake.notify();
    });
  };

  const dispatch = async (): Promise<void> => {
    let idleMs = pollIntervalMs;
    while (!halted) {
      const claimed = await claim();
      if (claimed !== undefined) {
        start(claimed);
        idleMs = pollIntervalMs;
        continue;
      }
      const reason = await wake.wait(idleMs);
      idleMs = reason === 'notified' ? pollIntervalMs : Math.min(idleMs * 2, maxPollIntervalMs);
    }
  };

  const dispatched = dispatch();
  return {
    halt: () => {
      halted = true;
      wake.notify();
      return dispatched;
    },
    inFlight: () => [...running.values()],
  };
};
