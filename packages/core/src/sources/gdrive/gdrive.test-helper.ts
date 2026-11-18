import { sourceRunSchema, type SourceRun } from '@liasse/contract';
import { eq } from 'drizzle-orm';
import { createSource } from '../../api/sources.ts';
import { documents } from '../../db/schema/documents.ts';
import { settings as settingsTable } from '../../db/schema/settings.ts';
import { documentOrigins, ingestionSources } from '../../db/schema/sources.ts';
import { createIngestHarness, type IngestHarness } from '../../ingest/harness.test-helper.ts';
import { writeSettings } from '../../settings/store.ts';
import { startFakeGoogle, type FakeGoogle } from '../../testing/fake-google.ts';
import { syntheticSettings } from '../../testing/synthetic-settings.ts';
import { createSourceFiles } from '../files.ts';
import { pollSource, type SourcePollDeps } from '../poll.ts';
import { updateSourceSecret } from '../secret.ts';
import {
  sourcesContext,
  storedSource,
  TEST_SECRETS,
  testConnectors,
} from '../sources.test-helper.ts';

export interface DriveHarness {
  readonly ingest: IngestHarness;
  readonly google: FakeGoogle;
  readonly deps: () => SourcePollDeps;
  readonly context: () => ReturnType<typeof sourcesContext>;
  readonly sourceFiles: () => ReturnType<typeof createSourceFiles>;
  /** A Drive source reading `folderId`, connected with a refresh token of the fake. */
  readonly addDriveSource: (folderId: string) => Promise<string>;
  readonly poll: (sourceId: string) => Promise<void>;
  readonly lastRun: (sourceId: string) => Promise<SourceRun>;
  readonly liveDocuments: () => Promise<readonly (typeof documents.$inferSelect)[]>;
  readonly origins: () => Promise<readonly (typeof documentOrigins.$inferSelect)[]>;
  /** Empties the database and starts a fresh fake Google, its client saved in the settings. */
  readonly reset: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

/** A real database and ingestion, with the fake Google as the only Google. */
export const createDriveHarness = async (): Promise<DriveHarness> => {
  const ingest = await createIngestHarness();
  const { db } = ingest.database;
  let google = await startFakeGoogle();
  const deps = (): SourcePollDeps => ({
    ...ingest.deps,
    secrets: TEST_SECRETS,
    connectors: testConnectors(db, google.endpoints).connectors,
  });
  const saveClient = async (): Promise<void> => {
    const settings = syntheticSettings({
      google: { client_id: google.client.clientId, client_secret: google.client.clientSecret },
    });
    if (
      (await writeSettings({ db, secrets: TEST_SECRETS }, { expectedVersion: 0, settings })) ===
      undefined
    ) {
      throw new Error('The settings of the test were not saved');
    }
  };
  await saveClient();
  return {
    ingest,
    get google() {
      return google;
    },
    deps,
    context: () => sourcesContext(db, undefined, google.endpoints),
    sourceFiles: () =>
      createSourceFiles({ db, secrets: TEST_SECRETS, connectors: deps().connectors }),
    addDriveSource: async (folderId) => {
      const source = await createSource(sourcesContext(db, undefined, google.endpoints), {
        kind: 'gdrive',
        name: 'Synthetic Drive',
        enabled: true,
        poll_interval_minutes: 5,
        private: false,
        config: { folder_id: folderId },
      });
      const secret = updateSourceSecret(TEST_SECRETS, source.id, null, {
        action: 'replace',
        value: google.grant(),
      });
      await db.update(ingestionSources).set({ secret }).where(eq(ingestionSources.id, source.id));
      return source.id;
    },
    poll: (sourceId) => pollSource(deps(), sourceId, new AbortController().signal),
    lastRun: async (sourceId) => sourceRunSchema.parse((await storedSource(db, sourceId)).lastRun),
    liveDocuments: async () =>
      (await db.select().from(documents)).filter(({ status }) => status !== 'deleted'),
    origins: () => db.select().from(documentOrigins),
    reset: async () => {
      await ingest.reset();
      await db.delete(ingestionSources);
      await google.close();
      google = await startFakeGoogle();
      await db.delete(settingsTable);
      await saveClient();
    },
    dispose: async () => {
      await google.close();
      await ingest.dispose();
    },
  };
};
