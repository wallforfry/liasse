import { type Settings, settingsSchema } from '@liasse/contract';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import type { Transaction } from '../db/isolation.ts';
import type { JsonObject } from '../db/columns.ts';
import { settings as settingsTable } from '../db/schema/settings.ts';
import { StartupError } from '../domain/errors.ts';
import type { SecretBox } from './secret-box.ts';

export interface SettingsStoreDeps {
  readonly db: Database | Transaction;
  readonly secrets: SecretBox;
}

export interface StoredSettings {
  /** 1 for the first save. */
  readonly version: number;
  readonly updatedAt: Date;
  readonly settings: Settings;
}

export class StoredSettingsError extends StartupError {
  override readonly name = 'StoredSettingsError';
}

const SECRET_SLOTS = ['llm', 'embedding', 'hindsight'] as const;
type SecretSlot = (typeof SECRET_SLOTS)[number];

const sealedSecretsSchema = z.partialRecord(z.enum(SECRET_SLOTS), z.string());
const sectionsSchema = z.record(z.string(), z.unknown());

interface SplitSettings {
  readonly document: JsonObject;
  readonly secrets: JsonObject;
}

const keyOf = (settings: Settings, slot: SecretSlot): string | undefined => settings[slot].api_key;

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
        const key = keyOf(settings, slot);
        return key === undefined ? [] : [[slot, box.seal(slot, key)]];
      }),
    ),
  };
};

const INVALID_ROW =
  'The stored settings do not match the settings of this version of Liasse. Save them ' +
  'again from the web UI.';

const join = (box: SecretBox, document: JsonObject, secrets: JsonObject): Settings => {
  const sections = sectionsSchema.safeParse(document);
  const sealed = sealedSecretsSchema.safeParse(secrets);
  if (!sections.success || !sealed.success) throw new StoredSettingsError(INVALID_ROW);
  const withKeys = Object.fromEntries(
    Object.entries(sections.data).map(([name, section]) => {
      const slot = SECRET_SLOTS.find((candidate) => candidate === name);
      const key = slot === undefined ? undefined : sealed.data[slot];
      return [
        name,
        key === undefined || slot === undefined || typeof section !== 'object'
          ? section
          : { ...section, api_key: box.open(slot, key) },
      ];
    }),
  );
  const parsed = settingsSchema.safeParse(withKeys);
  if (!parsed.success) throw new StoredSettingsError(INVALID_ROW);
  return parsed.data;
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

const storedOf = (box: SecretBox, row: Row): StoredSettings => ({
  version: row.version,
  updatedAt: row.updatedAt,
  settings: join(box, row.document, row.secrets),
});

/** The saved settings, keys decrypted, or undefined while none were saved. */
export const readSettings = async ({
  db,
  secrets,
}: SettingsStoreDeps): Promise<StoredSettings | undefined> => {
  const [row] = await db.select(COLUMNS).from(settingsTable);
  return row === undefined ? undefined : storedOf(secrets, row);
};

/** The version of the saved settings, 0 while none were saved; their keys stay sealed. */
export const storedSettingsVersion = async (db: Database | Transaction): Promise<number> => {
  const [row] = await db.select({ version: settingsTable.version }).from(settingsTable);
  return row?.version ?? 0;
};

export interface SettingsWrite {
  /** The version the settings were read at, 0 for none. */
  readonly expectedVersion: number;
  readonly settings: Settings;
}

/**
 * Writes the whole document when the stored version is still `expectedVersion`, in one
 * statement, so two saves of one version cannot both succeed. Resolves to undefined when
 * the version moved on.
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
  return row === undefined ? undefined : { ...row, settings };
};
