import { type Settings, type SettingsDraft, settingsDraftSchema } from '@liasse/contract';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { settings as settingsTable } from '../db/schema/settings.ts';
import { StartupError } from '../domain/errors.ts';
import { settingsFromDraft } from './draft.ts';
import { keysOf, SECRET_SLOTS, type StoredKey, type StoredKeys, unreadableSlots } from './keys.ts';
import { type SecretBox, SettingsSecretError } from './secret-box.ts';

/** A connection or a transaction: a save writes inside the transaction of its lock. */
export type SettingsExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

export interface SettingsStoreDeps {
  readonly db: SettingsExecutor;
  readonly secrets: SecretBox;
}

/** Every save notifies it with its version, in its transaction: other processes follow. */
export const SETTINGS_CHANNEL = 'liasse_settings';

export interface StoredSettings {
  /** 1 for the first save. */
  readonly version: number;
  readonly updatedAt: Date;
  /** The document as saved, its keys left to `keys`. */
  readonly document: SettingsDraft;
  readonly keys: StoredKeys;
}

export class StoredSettingsError extends StartupError {
  override readonly name = 'StoredSettingsError';
}

const sealedSecretsSchema = z.partialRecord(z.enum(SECRET_SLOTS), z.string());

interface SplitSettings {
  readonly document: JsonObject;
  readonly secrets: JsonObject;
}

// The keys leave the document before it is written: only their sealed form is stored.
const split = (box: SecretBox, settings: Settings): SplitSettings => {
  const {
    llm: { api_key: _llmKey, ...llm },
    embedding: { api_key: _embeddingKey, ...embedding },
    hindsight: { api_key: _hindsightKey, ...hindsight },
    pipeline,
  } = settings;
  return {
    document: { llm, embedding, pipeline, hindsight },
    secrets: Object.fromEntries(
      SECRET_SLOTS.flatMap((slot) => {
        const key = settings[slot].api_key;
        return key === undefined ? [] : [[slot, box.seal(slot, key)]];
      }),
    ),
  };
};

const INVALID_ROW =
  'The stored settings do not match the settings of this version of Liasse. Save them ' +
  'again with PUT /settings, or remove the row of the settings table.';

// A key sealed under another AUTH_SECRET is not an error of the row: it is reported, and
// a save replaces or clears it without ever reading it.
const opened = (box: SecretBox, slot: string, sealed: string | undefined): StoredKey => {
  if (sealed === undefined) return { state: 'unset' };
  try {
    return { state: 'set', value: box.open(slot, sealed) };
  } catch (error) {
    if (error instanceof SettingsSecretError) return { state: 'unreadable' };
    throw error;
  }
};

const COLUMNS = {
  version: settingsTable.version,
  updatedAt: settingsTable.updatedAt,
  document: settingsTable.document,
  secrets: settingsTable.secrets,
} as const;

interface Row {
  readonly version: number;
  readonly updatedAt: Date;
  readonly document: JsonObject;
  readonly secrets: JsonObject;
}

const storedOf = (box: SecretBox, row: Row): StoredSettings => {
  const document = settingsDraftSchema.safeParse(row.document);
  const sealed = sealedSecretsSchema.safeParse(row.secrets);
  if (!document.success || !sealed.success) throw new StoredSettingsError(INVALID_ROW);
  return {
    version: row.version,
    updatedAt: row.updatedAt,
    document: document.data,
    keys: {
      llm: opened(box, 'llm', sealed.data.llm),
      embedding: opened(box, 'embedding', sealed.data.embedding),
      hindsight: opened(box, 'hindsight', sealed.data.hindsight),
    },
  };
};

/** The saved settings, keys decrypted where they can be, or undefined while none were saved. */
export const readSettings = async ({
  db,
  secrets,
}: SettingsStoreDeps): Promise<StoredSettings | undefined> => {
  const [row] = await db.select(COLUMNS).from(settingsTable);
  return row === undefined ? undefined : storedOf(secrets, row);
};

/**
 * The settings in force of a stored document, or undefined while one of its keys does not
 * decrypt. A row the schema refuses otherwise stops the startup.
 */
export const settingsOf = (stored: StoredSettings): Settings | undefined => {
  if (unreadableSlots(stored.keys).length > 0) return undefined;
  const outcome = settingsFromDraft(stored.document, stored.keys);
  if (!outcome.ok) throw new StoredSettingsError(INVALID_ROW);
  return outcome.settings;
};

export interface SettingsWrite {
  /** The version the settings were read at, 0 for none. */
  readonly expectedVersion: number;
  readonly settings: Settings;
}

/**
 * Writes the whole document when the stored version is still `expectedVersion`, in one
 * statement, so two saves of one version cannot both succeed, and notifies the new version.
 * Resolves to undefined when the version moved on.
 */
export const writeSettings = async (
  { db, secrets }: SettingsStoreDeps,
  { expectedVersion, settings }: SettingsWrite,
): Promise<StoredSettings | undefined> => {
  const values = split(secrets, settings);
  const written = { version: settingsTable.version, updatedAt: settingsTable.updatedAt };
  const [row] =
    expectedVersion === 0
      ? await db
          .insert(settingsTable)
          .values({ version: 1, ...values })
          .onConflictDoNothing()
          .returning(written)
      : await db
          .update(settingsTable)
          .set({ version: sql`${settingsTable.version} + 1`, updatedAt: sql`now()`, ...values })
          .where(eq(settingsTable.version, expectedVersion))
          .returning(written);
  if (row === undefined) return undefined;
  // Delivered when the transaction of the write commits, never before.
  await db.execute(sql`SELECT pg_notify(${SETTINGS_CHANNEL}, ${String(row.version)})`);
  return { ...row, document: settingsDraftSchema.parse(values.document), keys: keysOf(settings) };
};
