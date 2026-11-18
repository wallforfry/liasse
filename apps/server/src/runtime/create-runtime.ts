import { GOOGLE_CALLBACK_PATH } from '@liasse/contract';
import { createFileUrls, type SettingsContext } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import { createDb, migrate } from '@liasse/core/db';
import type { CreateEmbedderOptions } from '@liasse/core/embeddings';
import { prepareFullTextRanking } from '@liasse/core/search';
import { createSecretBox, type ModelFactories, providerFactories } from '@liasse/core/settings';
import {
  createSourceFiles,
  createSourceRuntime,
  type GoogleEndpoints,
  storedGoogleClient,
} from '@liasse/core/sources';
import { createStorage } from '@liasse/core/storage';
import { createLogger, type Logger } from '../log.ts';
import { runShutdown, type ShutdownStep } from '../shutdown.ts';
import { type Bind, bindFeatures } from './bindings.ts';
import { type Front, startFront, type Transport } from './front.ts';
import { applyStored, createSettingsFollower } from './follow.ts';
import { createLiveRuntime } from './live.ts';
import { startupNotices, UNCONFIGURED_NOTICE } from './notices.ts';
import { step } from './step.ts';

export const DEFAULT_SHUTDOWN_GRACE_MS = 30_000;

export interface RuntimeOptions {
  readonly logger?: Logger;
  /** `bindFeatures` by default; a test binds handlers of its own. */
  readonly bind?: Bind;
  /** How the models are built from the settings; the providers by default, fakes in a test. */
  readonly models?: ModelFactories;
  /** How the provider factories build the embedder, when `models` is left out. */
  readonly embedder?: CreateEmbedderOptions;
  /** How long requests and jobs in progress may take to finish once `stop` is called. */
  readonly shutdownGraceMs?: number;
  /** `http` by default; `stdio` serves MCP on the standard streams and listens on nothing. */
  readonly transport?: Transport;
  /** Google itself by default; a test serves the HTTP contract of Google on a local port. */
  readonly google?: GoogleEndpoints;
}

export interface Runtime extends Omit<Front, 'stop'> {
  /** Resolves to false when something could not be stopped cleanly. Runs once. */
  readonly stop: () => Promise<boolean>;
}

/**
 * Builds the whole server from its configuration and the settings stored in its
 * database, in the order a failure is cheapest to explain, and starts it. Without stored
 * settings, or while one of their keys does not decrypt, it serves HTTP and runs nothing
 * else until they are saved. It follows the settings other processes save. Whatever was
 * started is stopped again when a later step fails. Everything it says goes to stderr
 * through the logger.
 */
export const createRuntime = async (
  config: Config,
  {
    logger = createLogger(),
    bind = bindFeatures,
    models,
    embedder: embedderOptions,
    shutdownGraceMs = DEFAULT_SHUTDOWN_GRACE_MS,
    transport = 'http',
    google,
  }: RuntimeOptions = {},
): Promise<Runtime> => {
  // Filled as the parts start, in the order they must stop.
  const stopping: ShutdownStep[] = [];
  const stopsBefore = (...stopSteps: readonly ShutdownStep[]): void => {
    stopping.unshift(...stopSteps);
  };

  try {
    startupNotices(config).forEach(logger.notice);

    await step('migrating the database', () =>
      migrate(config.database.url, { embeddingDim: config.embedding.dimension }),
    );
    const database = createDb(config.database.url);
    stopsBefore({ name: 'database', run: database.close });
    const { db } = database;
    const fullTextRanking = await step('preparing full-text ranking', () =>
      prepareFullTextRanking(db),
    );
    if (fullTextRanking.notice !== undefined) logger.notice(fullTextRanking.notice);

    const storage = createStorage(config.storage);
    await step('checking the file storage', storage.check);

    const fileUrls = createFileUrls({
      secret: config.auth.fileUrlSecret,
      publicUrl: config.server.publicUrl,
    });
    const secrets = createSecretBox(config.auth.secret);
    const { connectors, oauth } = createSourceRuntime({
      db,
      secrets,
      ...(google === undefined ? {} : { google }),
    });
    const sourceFiles = createSourceFiles({ db, secrets, connectors });
    const factories = models ?? providerFactories(embedderOptions);
    // The holder, its follower and the settings use cases need one another: the workers of
    // the holder catch up through the follower, which, like a save, puts settings in force
    // in the holder. Each is called only once all three exist.
    const settings: SettingsContext = {
      db,
      secrets,
      embedding: config.embedding,
      factories,
      prepare: (...args) => live.prepare(...args),
    };
    const follower = createSettingsFollower(
      settings,
      {
        prepare: (...args) => live.prepare(...args),
        version: () => live.version(),
      },
      logger,
    );
    const live = createLiveRuntime({
      config,
      db,
      storage,
      fullText: fullTextRanking.ranker,
      fileUrls,
      sources: { connectors, files: sourceFiles },
      factories,
      bind,
      logger,
      graceMs: shutdownGraceMs,
      catchUp: follower.catchUp,
    });
    stopsBefore(...live.stopSteps);
    const stored = await step('putting the settings in force', () =>
      applyStored(settings, live, logger.notice, { atBoot: true }),
    );
    if (stored === undefined) logger.notice(UNCONFIGURED_NOTICE);
    stopsBefore(await follower.start());

    const { stop: stopFront, ...front } = await startFront({
      transport,
      api: live.api,
      base: { db, storage, fileUrls, sourceFiles },
      settings,
      sources: {
        db,
        secrets,
        connectors,
        google: {
          oauth,
          client: storedGoogleClient(db, secrets),
          redirectUri: new URL(GOOGLE_CALLBACK_PATH, config.server.publicUrl).toString(),
        },
      },
      config,
      ping: database.ping,
      logger,
      graceMs: shutdownGraceMs,
    });
    stopsBefore(stopFront);

    let stopped: Promise<boolean> | undefined;
    return {
      ...front,
      stop: () => {
        stopped ??= runShutdown(stopping, logger);
        return stopped;
      },
    };
  } catch (error) {
    await runShutdown(stopping, logger);
    throw error;
  }
};
