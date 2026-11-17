import { createFileUrls, type SettingsContext } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import { createDb, migrate } from '@liasse/core/db';
import type { CreateEmbedderOptions } from '@liasse/core/embeddings';
import { prepareFullTextRanking } from '@liasse/core/search';
import { createSecretBox, type ModelFactories, providerFactories } from '@liasse/core/settings';
import { createStorage } from '@liasse/core/storage';
import { createLogger, type Logger } from '../log.ts';
import { runShutdown, type ShutdownStep } from '../shutdown.ts';
import { type Bind, bindFeatures } from './bindings.ts';
import { type Front, startFront, type Transport } from './front.ts';
import { applyStored, followSettings } from './follow.ts';
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
    const factories = models ?? providerFactories(embedderOptions);
    const live = createLiveRuntime({
      config,
      db,
      storage,
      fullText: fullTextRanking.ranker,
      fileUrls,
      factories,
      bind,
      logger,
      graceMs: shutdownGraceMs,
    });
    stopsBefore(...live.stopSteps);
    const settings: SettingsContext = {
      db,
      secrets: createSecretBox(config.auth.secret),
      embedding: config.embedding,
      factories,
      prepare: live.prepare,
    };

    const stored = await step('putting the settings in force', () =>
      applyStored(settings, live, logger.notice),
    );
    if (stored === undefined) logger.notice(UNCONFIGURED_NOTICE);
    stopsBefore(await followSettings(settings, live, logger));

    const { stop: stopFront, ...front } = await startFront({
      transport,
      api: live.api,
      base: { db, storage, fileUrls },
      settings,
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
