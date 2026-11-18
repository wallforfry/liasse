import type { SourceRun } from '@liasse/contract';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { ingestionSources } from '../db/schema/sources.ts';
import { withSessionAdvisoryLock } from '../db/session-lock.ts';
import { FileTooLargeError, IngestError } from '../ingest/errors.ts';
import { ingestFile } from '../ingest/ingest-file.ts';
import { cleanFilename } from '../ingest/untrusted-text.ts';
import type { SecretBox } from '../settings/secret-box.ts';
import type { Storage } from '../storage/port.ts';
import {
  SourceCredentialsError,
  type SourceConnectors,
  type SourceItem,
  SourceItemError,
} from './connector.ts';
import { recordOrigin } from './origins.ts';
import {
  countOutcome,
  EMPTY_TALLY,
  type ItemOutcome,
  type RunTally,
  summaryMessage,
  summaryOf,
} from './run-summary.ts';
import { cancelPolls, scheduleNextPoll } from './schedule.ts';
import { connectSource } from './connect.ts';
import { readSource, type StoredSource } from './store.ts';

export interface SourcePollDeps {
  readonly db: Database;
  readonly storage: Storage;
  /** In bytes; `max_file_size` of the settings. */
  readonly maxFileSize: number;
  readonly secrets: SecretBox;
  readonly connectors: SourceConnectors;
}

const lockKey = (sourceId: string) => sql`hashtextextended(${`liasse.source-run:${sourceId}`}, 0)`;

const MINUTE_MS = 60_000;

// An item refused for what it is: the cursor moves past it, and no later run takes it.
const takeItem = async (
  { db, storage, maxFileSize }: SourcePollDeps,
  sourceId: string,
  item: SourceItem,
): Promise<ItemOutcome> => {
  const skipped = (reason: string): ItemOutcome => ({
    kind: 'skipped',
    item: {
      external_id: item.externalId,
      name: cleanFilename(item.name),
      reason: summaryMessage(reason),
    },
  });
  if (item.size !== undefined && item.size > maxFileSize) {
    return skipped(new FileTooLargeError(maxFileSize).message);
  }
  try {
    const origin = { sourceId, externalId: item.externalId, name: item.name };
    const result = await ingestFile(
      { db, storage, maxFileSize },
      {
        stream: await item.open(),
        filename: item.name,
        source: 'connector',
        onIngested: (tx, ingested) => recordOrigin(tx, origin, ingested),
      },
    );
    return { kind: result.duplicate ? 'duplicate' : 'ingested' };
  } catch (error) {
    if (error instanceof IngestError || error instanceof SourceItemError) {
      return skipped(error.message);
    }
    throw error;
  }
};

const saveCursor = async (db: Database, sourceId: string, cursor: JsonObject): Promise<void> => {
  await db.update(ingestionSources).set({ cursor }).where(eq(ingestionSources.id, sourceId));
};

// Every change is handled in order and its cursor stored before the next one is asked for:
// a run that stops re-reads at most the item it was on, which the hash dedup absorbs.
const readChanges = async (
  deps: SourcePollDeps,
  source: StoredSource,
  signal: AbortSignal,
  onOutcome: (outcome: ItemOutcome) => void,
): Promise<void> => {
  const session = await connectSource(deps.secrets, deps.connectors, source, signal);
  try {
    for await (const change of session.changes(source.cursor)) {
      if (change.item !== undefined) onOutcome(await takeItem(deps, source.id, change.item));
      await saveCursor(deps.db, source.id, change.cursor);
    }
  } finally {
    // The run's own outcome matters, not whether the server saw the logout.
    await session.close().catch(() => undefined);
  }
};

const finishRun = async (db: Database, sourceId: string, run: SourceRun): Promise<void> => {
  await db.update(ingestionSources).set({ lastRun: run }).where(eq(ingestionSources.id, sourceId));
};

// Polling stops until a person saves the source, unless one did since the run read it.
const flagCredentials = (db: Database, source: StoredSource, run: SourceRun): Promise<void> =>
  db.transaction(async (tx) => {
    const flagged = await tx
      .update(ingestionSources)
      .set({ lastRun: run, needsAttention: true })
      .where(
        and(
          eq(ingestionSources.id, source.id),
          // The Date read back has milliseconds only, the column microseconds.
          sql`date_trunc('milliseconds', ${ingestionSources.updatedAt}) = ${source.updatedAt.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: ingestionSources.id });
    if (flagged.length === 0) return;
    await cancelPolls(tx, source.id);
  });

const errorMessage = (error: unknown): string =>
  summaryMessage(error instanceof Error ? error.message : String(error));

const runLocked = async (
  deps: SourcePollDeps,
  sourceId: string,
  signal: AbortSignal,
): Promise<void> => {
  const source = await readSource(deps.db, sourceId);
  if (source === undefined || !source.enabled || source.needsAttention) return;
  const startedAt = new Date();
  await scheduleNextPoll(
    deps.db,
    sourceId,
    new Date(startedAt.getTime() + source.pollIntervalMinutes * MINUTE_MS),
  );
  let tally: RunTally = EMPTY_TALLY;
  try {
    await readChanges(deps, source, signal, (outcome) => {
      tally = countOutcome(tally, outcome);
    });
    await finishRun(deps.db, sourceId, summaryOf(startedAt, tally, null));
  } catch (error) {
    if (error instanceof SourceCredentialsError) {
      const run = summaryOf(startedAt, tally, {
        kind: 'credentials',
        message: errorMessage(error),
      });
      await flagCredentials(deps.db, source, run);
      return;
    }
    const run = summaryOf(startedAt, tally, { kind: 'transient', message: errorMessage(error) });
    await finishRun(deps.db, sourceId, run);
    throw error;
  }
};

/**
 * Reads what a source holds since its cursor and ingests it, unless another run of the
 * same source is in progress, in which case it returns at once. A transient failure is
 * recorded and rethrown, for the retries of the queue; a refusal of the credentials
 * stops the polling of the source until a person saves it.
 */
export const pollSource = async (
  deps: SourcePollDeps,
  sourceId: string,
  signal: AbortSignal,
): Promise<void> => {
  await withSessionAdvisoryLock(deps.db, lockKey(sourceId), () =>
    runLocked(deps, sourceId, signal),
  );
};
