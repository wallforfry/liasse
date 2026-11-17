import type { Settings } from '@liasse/contract';
import { createDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { createSecretBox } from '../settings/secret-box.ts';
import { readSettings, writeSettings } from '../settings/store.ts';

export interface SettingsSeed {
  readonly databaseUrl: string;
  /** `AUTH_SECRET` of the server that will read them: their keys are sealed under it. */
  readonly authSecret: string;
  /** `EMBEDDING_DIM`, which the migration of a new database needs. */
  readonly embeddingDim: number;
  readonly settings: Settings;
}

/**
 * Migrates the database and saves these settings in it, over whatever it held, as a save
 * of the web UI leaves them: for a server a test or an evaluation run starts configured.
 */
export const seedSettings = async ({
  databaseUrl,
  authSecret,
  embeddingDim,
  settings,
}: SettingsSeed): Promise<void> => {
  await migrate(databaseUrl, { embeddingDim });
  const database = createDb(databaseUrl);
  try {
    const deps = { db: database.db, secrets: createSecretBox(authSecret) };
    const expectedVersion = (await readSettings(deps))?.version ?? 0;
    const written = await writeSettings(deps, { expectedVersion, settings });
    if (written === undefined) throw new Error('The settings changed while they were seeded');
  } finally {
    await database.close();
  }
};
