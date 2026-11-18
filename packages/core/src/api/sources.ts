import type {
  SecretUpdate,
  Source,
  SourceCheck,
  SourceCreate,
  SourceList,
  SourcePatch,
  SourceRunRequest,
} from '@liasse/contract';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { ingestionSources } from '../db/schema/sources.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import type { SecretBox } from '../settings/secret-box.ts';
import { checkSource as checkStoredSource } from '../sources/check.ts';
import type { SourceConnectors } from '../sources/connector.ts';
import { cancelPolls, queuePollNow } from '../sources/schedule.ts';
import { updateSourceSecret } from '../sources/secret.ts';
import {
  parseSourceRow,
  readSource,
  readSources,
  sourceViewOf,
  type StoredSource,
} from '../sources/store.ts';
import { ApiError } from './errors.ts';

/** What the source use cases need. They exist before any settings do. */
export interface SourcesContext {
  readonly db: Database;
  readonly secrets: SecretBox;
  readonly connectors: SourceConnectors;
}

// A check connects to a remote server: bounded apart from the deadline of the request.
const CHECK_TIMEOUT_MS = 60_000;

const sourceNotFound = (): ApiError =>
  new ApiError('not_found', 'source_not_found', 'No source has this id.');

export const listSources = async ({ db, secrets }: SourcesContext): Promise<SourceList> => ({
  sources: (await readSources(db)).map((source) => sourceViewOf(secrets, source)),
});

export const getSource = async ({ db, secrets }: SourcesContext, id: string): Promise<Source> => {
  const source = await readSource(db, id);
  if (source === undefined) throw sourceNotFound();
  return sourceViewOf(secrets, source);
};

/** Creates a source; an enabled one runs at once. */
export const createSource = async (
  context: SourcesContext,
  input: SourceCreate,
): Promise<Source> => {
  const id = newId(ID_PREFIXES.ingestionSource);
  await context.db.transaction(async (tx) => {
    await tx.insert(ingestionSources).values({
      id,
      kind: input.kind,
      name: input.name,
      enabled: input.enabled,
      pollIntervalMinutes: input.poll_interval_minutes,
      hint: input.hint ?? null,
      private: input.private,
      config: input.config,
      secret: updateSourceSecret(context.secrets, id, null, input.secret),
    });
    if (input.enabled) await queuePollNow(tx, id);
  });
  return getSource(context, id);
};

// The stored password was given for one server and one way to reach it: it is not handed
// to another host, nor sent over a weaker connection, without being entered again.
const sendsSecretElsewhere = (
  stored: StoredSource,
  config: StoredSource['config'],
  secret: SecretUpdate,
): boolean =>
  secret.action === 'keep' &&
  stored.secret !== null &&
  (config.host !== stored.config.host || config.security !== stored.config.security);

/**
 * Saves a source. A save is a person acting on it: it clears the flag of refused
 * credentials, and an enabled source runs at once with what was saved. The cursor stays:
 * a mailbox added starts from the start date, the others where they were.
 */
export const updateSource = async (
  context: SourcesContext,
  id: string,
  patch: SourcePatch,
): Promise<Source> => {
  await context.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(ingestionSources)
      .where(eq(ingestionSources.id, id))
      .for('update');
    if (row === undefined) throw sourceNotFound();
    const stored = parseSourceRow(row);
    const config = patch.config ?? stored.config;
    if (sendsSecretElsewhere(stored, config, patch.secret)) {
      throw new ApiError(
        'invalid',
        'source_secret_required',
        'A new host or connection security would receive the stored password: enter it again.',
      );
    }
    const enabled = patch.enabled ?? stored.enabled;
    await tx
      .update(ingestionSources)
      .set({
        name: patch.name ?? stored.name,
        enabled,
        pollIntervalMinutes: patch.poll_interval_minutes ?? stored.pollIntervalMinutes,
        hint: patch.hint === undefined ? stored.hint : patch.hint,
        private: patch.private ?? stored.private,
        config,
        secret: updateSourceSecret(context.secrets, id, stored.secret, patch.secret),
        needsAttention: false,
        updatedAt: new Date(),
      })
      .where(eq(ingestionSources.id, id));
    await cancelPolls(tx, id);
    if (enabled) await queuePollNow(tx, id);
  });
  return getSource(context, id);
};

/**
 * Deletes a source and its queued runs. Its documents stay; what said they came from it
 * goes. A run in progress finishes the item it is on, then finds nothing to write to.
 */
export const deleteSource = async ({ db }: SourcesContext, id: string): Promise<void> => {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(ingestionSources)
      .where(eq(ingestionSources.id, id))
      .returning({ id: ingestionSources.id });
    if (deleted.length === 0) throw sourceNotFound();
    await cancelPolls(tx, id);
  });
};

/** Tries the stored credentials and lists the first items the next run would take. */
export const checkSource = async (context: SourcesContext, id: string): Promise<SourceCheck> => {
  const source = await readSource(context.db, id);
  if (source === undefined) throw sourceNotFound();
  return checkStoredSource(context, source, AbortSignal.timeout(CHECK_TIMEOUT_MS));
};

/** Queues a run due at once, unless one is. */
export const requestSourceRun = async (
  { db }: SourcesContext,
  id: string,
): Promise<SourceRunRequest> => {
  const source = await readSource(db, id);
  if (source === undefined) throw sourceNotFound();
  if (!source.enabled) {
    throw new ApiError('conflict', 'source_disabled', 'The source is disabled: enable it first.');
  }
  if (source.needsAttention) {
    throw new ApiError(
      'conflict',
      'source_needs_attention',
      'The credentials were refused: save the source with working ones first.',
    );
  }
  return { queued: await db.transaction((tx) => queuePollNow(tx, id)) };
};
