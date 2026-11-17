import { type Settings, settingsUpdateSchema } from '@liasse/contract';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { settings as settingsTable } from '../db/schema/settings.ts';
import { createIngestHarness, type IngestHarness } from '../ingest/harness.test-helper.ts';
import { ingestFile } from '../ingest/ingest-file.ts';
import { holdEmbedderExclusive, holdEmbedderShared } from '../settings/embedder-lock.ts';
import { createSecretBox } from '../settings/secret-box.ts';
import { readSettings, writeSettings } from '../settings/store.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { createFakeModelFactories } from '../testing/fake-model-factories.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import {
  SYNTHETIC_EMBEDDING_ENVIRONMENT,
  SYNTHETIC_SETTINGS,
  syntheticSettings,
} from '../testing/synthetic-settings.ts';
import { ApiError } from './errors.ts';
import { type PreparedSettings, saveSettings, type SettingsContext } from './settings.ts';

const REMOTE = { provider: 'ollama', model: 'embedding-model' } as const;

describe('saveSettings', () => {
  let harness: IngestHarness;
  const secrets = createSecretBox('synthetic-auth-secret-0123456789abcdef');
  const prepared: { settings: Settings; outcome: string }[] = [];

  // Records what became of each preparation: put in force and settled, or discarded.
  const contextOf = (): SettingsContext => ({
    db: harness.database.db,
    secrets,
    embedding: SYNTHETIC_EMBEDDING_ENVIRONMENT,
    factories: createFakeModelFactories(),
    prepare: (settings): Promise<PreparedSettings> => {
      const entry = { settings, outcome: 'prepared' };
      prepared.push(entry);
      return Promise.resolve({
        putInForce: () => {
          entry.outcome = 'in force';
        },
        settle: () => {
          entry.outcome = `${entry.outcome}, settled`;
          return Promise.resolve();
        },
        discard: () => {
          entry.outcome = `${entry.outcome}, discarded`;
          return Promise.resolve();
        },
      });
    },
  });

  const draft = (embedding: object = REMOTE) => ({
    llm: SYNTHETIC_SETTINGS.llm,
    embedding: { ...embedding, base_url: 'http://127.0.0.1:9' },
  });
  const update = (embedding?: object) =>
    settingsUpdateSchema.parse({ version: 1, settings: draft(embedding) });

  const seed = async (): Promise<void> => {
    await writeSettings(
      { db: harness.database.db, secrets },
      {
        expectedVersion: 0,
        settings: syntheticSettings({ embedding: { ...REMOTE, base_url: 'http://127.0.0.1:9' } }),
      },
    );
  };

  const codeOf = (work: Promise<unknown>): Promise<string> =>
    work.then(
      () => 'saved',
      (error: unknown) => (error instanceof ApiError ? error.code : String(error)),
    );

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    prepared.length = 0;
    await harness.database.db.delete(settingsTable);
    await harness.database.db.delete(jobs);
    await harness.database.db.delete(documents);
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('discards what it prepared when the write fails, so the next save goes through', async () => {
    await seed();
    const { db } = harness.database;
    await db.execute(
      sql`ALTER TABLE settings ADD CONSTRAINT settings_refused CHECK (false) NOT VALID`,
    );
    try {
      expect(await codeOf(saveSettings(contextOf(), update()))).toContain('Failed query');
    } finally {
      await db.execute(sql`ALTER TABLE settings DROP CONSTRAINT settings_refused`);
    }
    expect(prepared.map(({ outcome }) => outcome)).toEqual(['prepared, discarded']);
    expect(await codeOf(saveSettings(contextOf(), update()))).toBe('saved');
    expect(prepared.map(({ outcome }) => outcome)).toEqual([
      'prepared, discarded',
      'in force, settled',
    ]);
  });

  it('refuses an embedder change once an ingestion holding the lock commits a document', async () => {
    await seed();
    const { db } = harness.database;
    const inserted = createGate();
    const release = createGate();
    const ingestion = db.transaction(async (tx) => {
      await holdEmbedderShared(tx);
      await tx.insert(documents).values({
        sha256: 'synthetic-sha256-locked',
        storageKey: 'synthetic/locked',
        mime: 'application/pdf',
        originalName: 'locked.pdf',
        source: 'api',
      });
      inserted.open();
      await release.opened;
    });
    await inserted.opened;
    const save = codeOf(saveSettings(contextOf(), update({ ...REMOTE, model: 'other' })));
    await waitUntil(async () => (await waitingAdvisoryLocks()) === 1);
    release.open();
    await ingestion;
    expect(await save).toBe('embedder_locked');
    expect(prepared.map(({ outcome }) => outcome)).toEqual(['prepared, discarded']);
    expect((await readSettings({ db, secrets }))?.document.embedding.model).toBe('embedding-model');
  });

  it('holds an ingestion back while a save that changes the embedder holds the lock', async () => {
    const { db } = harness.database;
    const locked = createGate();
    const release = createGate();
    const save = db.transaction(async (tx) => {
      await holdEmbedderExclusive(tx);
      locked.open();
      await release.opened;
    });
    await locked.opened;
    const ingestion = ingestFile(harness.deps, {
      bytes: syntheticPdf('held back'),
      filename: 'held.pdf',
      source: 'api',
    });
    await waitUntil(async () => (await waitingAdvisoryLocks()) === 1);
    expect(await db.$count(documents)).toBe(0);
    release.open();
    await save;
    await ingestion;
    expect(await db.$count(documents)).toBe(1);
  });

  const waitingAdvisoryLocks = async (): Promise<number> => {
    const rows = await harness.database.db.$client`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    return Number(rows[0]?.waiting ?? 0);
  };
});
