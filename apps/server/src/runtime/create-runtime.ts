import { type ApiContext, createFileUrls } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import { createDb, migrate } from '@liasse/core/db';
import { StartupError } from '@liasse/core/domain';
import { createEmbedder, type CreateEmbedderOptions } from '@liasse/core/embeddings';
import { createTextModel, createVisionModel } from '@liasse/core/models';
import { prepareFullTextRanking } from '@liasse/core/search';
import { createStorage } from '@liasse/core/storage';
import { createLogger, describeError, type Logger } from '../log.ts';
import { runShutdown, type ShutdownStep } from '../shutdown.ts';
import { startFolder, startQueue } from './background.ts';
import { type Bind, bindFeatures } from './bindings.ts';
import { type Front, startFront, type Transport } from './front.ts';
import { startupNotices } from './notices.ts';

export const DEFAULT_SHUTDOWN_GRACE_MS = 30_000;

export interface RuntimeOptions {
  readonly logger?: Logger;
  /** `bindFeatures` by default; a test binds handlers of its own. */
  readonly bind?: Bind;
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

const reasonOf = (error: unknown): string => {
  const { error: name, sqlstate } = describeError(error);
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return [name, typeof code === 'string' ? code : undefined, sqlstate]
    .filter((part, index, parts) => part !== undefined && parts.indexOf(part) === index)
    .join(' ');
};

/**
 * Runs one step of the startup. An error meant for the operator passes as it is; any
 * other becomes one that names the step and the class of what failed, never its
 * message: a driver may quote a connection URL there.
 */
const step = async <Result>(
  name: string,
  work: () => Result | Promise<Result>,
): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StartupError) throw error;
    throw new StartupError(`Liasse could not start: ${name} failed (${reasonOf(error)}).`, {
      cause: error,
    });
  }
};

/**
 * Builds the whole server from its configuration, in the order a failure is cheapest
 * to explain, and starts it. Whatever was started is stopped again when a later step
 * fails. Everything it says goes to stderr through the logger.
 */
export const createRuntime = async (
  config: Config,
  {
    logger = createLogger(),
    bind = bindFeatures,
    embedder: embedderOptions,
    shutdownGraceMs = DEFAULT_SHUTDOWN_GRACE_MS,
    transport = 'http',
  }: RuntimeOptions = {},
): Promise<Runtime> => {
  // Filled as the parts start, in the order they must stop.
  const stopping: ShutdownStep[] = [];
  const stopsBefore = (stopStep: ShutdownStep): void => {
    stopping.unshift(stopStep);
  };

  try {
    (await startupNotices(config)).forEach(logger.notice);

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

    const { embedder, close: closeEmbedder } = await step('creating the embedder', () =>
      createEmbedder(config.embedding, embedderOptions),
    );
    stopsBefore({ name: 'embedder', run: closeEmbedder });
    const textModel = await step('creating the text model', () => createTextModel(config.llm));
    const visionModel = await step('creating the vision model', () =>
      createVisionModel(config.llm),
    );

    const bindings = bind({ config, db, storage, embedder, textModel, visionModel, logger });
    bindings.notices.forEach(logger.notice);
    for (const task of bindings.startupTasks) await step(task.name, task.run);

    const queue = await step('starting the workers', () =>
      startQueue({ db, config, bindings, logger, graceMs: shutdownGraceMs }),
    );
    stopsBefore(queue);
    stopsBefore(startFolder({ db, storage, config, logger }));

    const api: ApiContext = {
      db,
      storage,
      embedder,
      fullText: fullTextRanking.ranker,
      maxFileSize: config.pipeline.maxFileSize,
      fileUrls: createFileUrls({
        secret: config.auth.fileUrlSecret,
        publicUrl: config.server.publicUrl,
      }),
      features: bindings.features,
    };
    const { stop: stopFront, ...front } = await startFront({
      transport,
      api,
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
