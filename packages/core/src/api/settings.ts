import type {
  Settings,
  SettingsCheck,
  SettingsCheckRequest,
  SettingsState,
  SettingsUpdate,
} from '@liasse/contract';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { StartupError } from '../domain/errors.ts';
import { checkSettings } from '../settings/check.ts';
import { sameEmbedder, settingsFromDraft, settingsViewOf } from '../settings/draft.ts';
import { holdEmbedderExclusive } from '../settings/embedder-lock.ts';
import type { ModelFactories } from '../settings/factories.ts';
import { NO_KEYS, type StoredKeys } from '../settings/keys.ts';
import { type EmbeddingEnvironment, resolveSettings } from '../settings/resolve.ts';
import type { SecretBox } from '../settings/secret-box.ts';
import {
  readSettings,
  type SettingsExecutor,
  type StoredSettings,
  writeSettings,
} from '../settings/store.ts';
import { ApiError, invalidRequest } from './errors.ts';

/**
 * Settings built for the process but not in force yet. Exactly one of `discard` or
 * `settle` follows a preparation: one preparation runs at a time until then.
 */
export interface PreparedSettings {
  /** Puts the parts in force at once; `discard` puts the previous ones back. */
  readonly putInForce: () => void;
  /** Once the settings are saved: starts what they need, closes what they replaced. */
  readonly settle: () => Promise<void>;
  /** Drops the parts, and the previous ones are in force again. */
  readonly discard: () => Promise<void>;
}

/** What the settings use cases need. They exist before any settings do. */
export interface SettingsContext {
  readonly db: Database;
  readonly secrets: SecretBox;
  /** `EMBEDDING_DIM` and `EMBEDDING_CACHE_DIR`. */
  readonly embedding: EmbeddingEnvironment;
  /** Builds the parts a check tries. */
  readonly factories: ModelFactories;
  /** Builds the parts of the process from the settings of `version`, not in force yet. */
  readonly prepare: (settings: Settings, version: number) => Promise<PreparedSettings>;
}

const hasLiveDocument = async (db: SettingsExecutor): Promise<boolean> =>
  (await db.select({ id: documents.id }).from(documents).where(isLiveDocument).limit(1)).length > 0;

const stateOf = (stored: StoredSettings | undefined, embedderLocked: boolean): SettingsState => ({
  version: stored?.version ?? 0,
  updated_at: stored?.updatedAt.toISOString() ?? null,
  settings: stored === undefined ? null : settingsViewOf(stored.document, stored.keys),
  embedder_locked: embedderLocked,
});

/** The saved settings, keys replaced by their state. */
export const readSettingsState = async (context: SettingsContext): Promise<SettingsState> =>
  stateOf(await readSettings(context), await hasLiveDocument(context.db));

const staleVersion = (): ApiError =>
  new ApiError(
    'conflict',
    'settings_conflict',
    'The settings changed since they were read. Read them again, then save.',
  );

const embedderLocked = (): ApiError =>
  new ApiError(
    'conflict',
    'embedder_locked',
    'The embedder cannot change once a document exists: the stored vectors are its own.',
  );

/** The settings a draft leads to with these keys, or the issues that make it invalid. */
export const settingsCandidate = (
  update: SettingsUpdate['settings'],
  keys: StoredKeys,
): Settings => {
  const outcome = settingsFromDraft(update, keys);
  if (!outcome.ok) throw invalidRequest(outcome.issues);
  return outcome.settings;
};

/** The parts built from settings, not in force yet; an inapplicable model is the caller's. */
export const prepareSettings = async (
  context: SettingsContext,
  settings: Settings,
  version: number,
): Promise<PreparedSettings> => {
  try {
    return await context.prepare(settings, version);
  } catch (error) {
    // Written for the operator, and holding no value of the settings: the embedder refuses
    // a local model of another dimension that way.
    if (error instanceof StartupError) {
      throw new ApiError('invalid', 'settings_not_applicable', error.message);
    }
    throw error;
  }
};

/**
 * Saves the whole document when `version` is still the stored one, and puts it in force
 * in the transaction of the write. The embedder cannot change once a live document exists:
 * its vectors are stored. Ingestion holds the embedder lock shared, so no document becomes
 * live between that count and the new parts in force.
 */
export const saveSettings = async (
  context: SettingsContext,
  { version, settings: draft }: SettingsUpdate,
): Promise<SettingsState> => {
  const stored = await readSettings(context);
  if ((stored?.version ?? 0) !== version) throw staleVersion();
  const settings = settingsCandidate(draft, stored?.keys ?? NO_KEYS);
  const embedderChanges = stored !== undefined && !sameEmbedder(stored.document, settings);
  const parts = await prepareSettings(context, settings, version + 1);
  const written = await context.db
    .transaction(async (tx) => {
      if (embedderChanges) {
        await holdEmbedderExclusive(tx);
        if (await hasLiveDocument(tx)) throw embedderLocked();
      }
      const row = await writeSettings(
        { db: tx, secrets: context.secrets },
        { expectedVersion: version, settings },
      );
      if (row === undefined) throw staleVersion();
      parts.putInForce();
      return row;
    })
    .catch(async (error: unknown) => {
      await parts.discard();
      throw error;
    });
  await parts.settle();
  return stateOf(written, await hasLiveDocument(context.db));
};

/** Tries settings without saving them; a kept key is the stored one. */
export const checkSettingsDraft = async (
  context: SettingsContext,
  { settings: draft }: SettingsCheckRequest,
): Promise<SettingsCheck> => {
  const settings = settingsCandidate(draft, (await readSettings(context))?.keys ?? NO_KEYS);
  return checkSettings(context.factories, resolveSettings(settings, context.embedding));
};
