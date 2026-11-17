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
import type { ModelFactories } from '../settings/factories.ts';
import { type EmbeddingEnvironment, resolveSettings } from '../settings/resolve.ts';
import type { SecretBox } from '../settings/secret-box.ts';
import { readSettings, type StoredSettings, writeSettings } from '../settings/store.ts';
import { ApiError, invalidRequest } from './errors.ts';

/** Settings built for the process but not in force yet: activated once saved, or dropped. */
export interface PreparedSettings {
  readonly activate: () => Promise<void>;
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
  /** Builds the parts of the process from settings, without putting them in force. */
  readonly prepare: (settings: Settings) => Promise<PreparedSettings>;
}

const hasLiveDocument = async (db: Database): Promise<boolean> =>
  (await db.select({ id: documents.id }).from(documents).where(isLiveDocument).limit(1)).length > 0;

const stateOf = (stored: StoredSettings | undefined, embedderLocked: boolean): SettingsState => ({
  version: stored?.version ?? 0,
  updated_at: stored?.updatedAt.toISOString() ?? null,
  settings: stored === undefined ? null : settingsViewOf(stored.settings),
  embedder_locked: embedderLocked,
});

/** The saved settings, keys replaced by whether each is set. */
export const readSettingsState = async (context: SettingsContext): Promise<SettingsState> =>
  stateOf(await readSettings(context), await hasLiveDocument(context.db));

const staleVersion = (): ApiError =>
  new ApiError(
    'conflict',
    'settings_conflict',
    'The settings changed since they were read. Read them again, then save.',
  );

const candidateOf = (update: SettingsUpdate['settings'], stored: Settings | undefined) => {
  const candidate = settingsFromDraft(update, stored);
  if (!candidate.success) throw invalidRequest(candidate.error.issues);
  return candidate.data;
};

const prepared = async (context: SettingsContext, settings: Settings) => {
  try {
    return await context.prepare(settings);
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
 * Saves the whole document when `version` is still the stored one, then puts it in force.
 * The embedder cannot change once a live document exists: its vectors are stored.
 */
export const saveSettings = async (
  context: SettingsContext,
  { version, settings: draft }: SettingsUpdate,
): Promise<SettingsState> => {
  const stored = await readSettings(context);
  if ((stored?.version ?? 0) !== version) throw staleVersion();
  const settings = candidateOf(draft, stored?.settings);
  const embedderLocked = await hasLiveDocument(context.db);
  if (stored !== undefined && embedderLocked && !sameEmbedder(stored.settings, settings)) {
    throw new ApiError(
      'conflict',
      'embedder_locked',
      'The embedder cannot change once a document exists: the stored vectors are its own.',
    );
  }
  const parts = await prepared(context, settings);
  const written = await writeSettings(context, { expectedVersion: version, settings });
  if (written === undefined) {
    await parts.discard();
    throw staleVersion();
  }
  await parts.activate();
  return stateOf(written, embedderLocked);
};

/** Tries settings without saving them; a kept key is the stored one. */
export const checkSettingsDraft = async (
  context: SettingsContext,
  { settings: draft }: SettingsCheckRequest,
): Promise<SettingsCheck> => {
  const settings = candidateOf(draft, (await readSettings(context))?.settings);
  return checkSettings(context.factories, resolveSettings(settings, context.embedding));
};
