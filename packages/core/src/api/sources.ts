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
import { bindConnector } from '../sources/connect.ts';
import type { GoogleClientReader } from '../sources/google/client.ts';
import type { GoogleOAuth } from '../sources/google/oauth.ts';
import { openSourceSecret, updateSourceSecret } from '../sources/secret.ts';
import {
  parseSourceRow,
  readSource,
  readSources,
  sourceViewOf,
  type StoredSource,
} from '../sources/store.ts';
import { ApiError } from './errors.ts';

/** What a Drive source needs to be connected to Google. */
export interface GoogleConsentContext {
  readonly oauth: GoogleOAuth;
  readonly client: GoogleClientReader;
  /** `PUBLIC_URL/sources/google/callback`, registered in the Google client. */
  readonly redirectUri: string;
}

/** What the source use cases need. They exist before any settings do. */
export interface SourcesContext {
  readonly db: Database;
  readonly secrets: SecretBox;
  readonly connectors: SourceConnectors;
  readonly google: GoogleConsentContext;
}

const KEEP: SecretUpdate = { action: 'keep' };

// A Drive source gets its secret from the consent at Google, never from a request.
const secretUpdateOf = (input: SourceCreate | SourcePatch): SecretUpdate =>
  input.kind === 'imap' ? input.secret : KEEP;

// A check connects to a remote server: bounded apart from the deadline of the request.
const CHECK_TIMEOUT_MS = 60_000;

const sourceNotFound = (): ApiError => new ApiError('source_not_found', 'No source has this id.');

export const listSources = async ({ db, secrets }: SourcesContext): Promise<SourceList> => ({
  sources: (await readSources(db)).map((source) => sourceViewOf(secrets, source)),
});

export const getSource = async ({ db, secrets }: SourcesContext, id: string): Promise<Source> => {
  const source = await readSource(db, id);
  if (source === undefined) throw sourceNotFound();
  return sourceViewOf(secrets, source);
};

/** Creates a source; an enabled one with credentials runs at once. */
export const createSource = async (
  context: SourcesContext,
  input: SourceCreate,
): Promise<Source> => {
  const id = newId(ID_PREFIXES.ingestionSource);
  const secret = updateSourceSecret(context.secrets, id, null, secretUpdateOf(input));
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
      secret,
    });
    // A source without credentials would only fail: it runs once it has them.
    if (input.enabled && secret !== null) await queuePollNow(tx, id);
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
  stored.kind === 'imap' &&
  'host' in config &&
  secret.action === 'keep' &&
  stored.secret !== null &&
  (config.host !== stored.config.host || config.security !== stored.config.security);

// The kind of a source never changes: a patch names it, and must name the stored one.
const configAfter = (stored: StoredSource, patch: SourcePatch): StoredSource['config'] => {
  if (patch.kind !== stored.kind) {
    throw new ApiError('source_kind_mismatch', `The source is of kind ${stored.kind}.`);
  }
  return patch.config ?? stored.config;
};

/**
 * Saves a source. A save is a person acting on it: it clears the flag of refused
 * credentials, and an enabled source with credentials runs at once with what was saved. A
 * Drive source keeps its authorization, which only a consent at Google replaces. The cursor stays:
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
    const config = configAfter(stored, patch);
    const update = secretUpdateOf(patch);
    if (sendsSecretElsewhere(stored, config, update)) {
      throw new ApiError(
        'source_secret_required',
        'A new host or connection security would receive the stored password: enter it again.',
      );
    }
    const enabled = patch.enabled ?? stored.enabled;
    const secret = updateSourceSecret(context.secrets, id, stored.secret, update);
    await tx
      .update(ingestionSources)
      .set({
        name: patch.name ?? stored.name,
        enabled,
        pollIntervalMinutes: patch.poll_interval_minutes ?? stored.pollIntervalMinutes,
        hint: patch.hint === undefined ? stored.hint : patch.hint,
        private: patch.private ?? stored.private,
        config,
        secret,
        needsAttention: false,
        updatedAt: new Date(),
      })
      .where(eq(ingestionSources.id, id));
    await cancelPolls(tx, id);
    if (enabled && secret !== null) await queuePollNow(tx, id);
  });
  return getSource(context, id);
};

const FORGET_TIMEOUT_MS = 30_000;

/**
 * Deletes a source and its queued runs. Its documents stay; what said they came from it
 * goes, so a document whose file stayed at the source can no longer serve it. A run in
 * progress finishes the item it is on, then finds nothing to write to. The credentials of
 * a source that can revoke them, a Drive's authorization, are revoked at the source.
 */
export const deleteSource = async (
  { db, secrets, connectors }: SourcesContext,
  id: string,
): Promise<void> => {
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx.delete(ingestionSources).where(eq(ingestionSources.id, id)).returning();
    if (row === undefined) throw sourceNotFound();
    await cancelPolls(tx, id);
    return parseSourceRow(row);
  });
  const { forget } = bindConnector(connectors, deleted);
  const secret = openSourceSecret(secrets, deleted.id, deleted.secret);
  if (forget === undefined || secret.state !== 'set') return;
  // Best effort: the token left Liasse with the row, and Google ends a refresh token
  // that goes unused for six months.
  await forget(secret.value, AbortSignal.timeout(FORGET_TIMEOUT_MS)).catch(() => undefined);
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
    throw new ApiError('source_disabled', 'The source is disabled: enable it first.');
  }
  if (source.needsAttention) {
    throw new ApiError(
      'source_needs_attention',
      'The credentials were refused: save the source with working ones first.',
    );
  }
  return { queued: await db.transaction((tx) => queuePollNow(tx, id)) };
};
