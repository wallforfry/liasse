import { isDeepStrictEqual } from 'node:util';
import type { Settings } from '@liasse/contract';
import type { ApiContext, FileUrls, PreparedSettings } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import type { Database } from '@liasse/core/db';
import type { ConfiguredEmbedder } from '@liasse/core/embeddings';
import type { HandlerSet } from '@liasse/core/jobs';
import type { ChunkRanker } from '@liasse/core/search';
import { type ModelFactories, type ResolvedSettings, resolveSettings } from '@liasse/core/settings';
import type { Storage } from '@liasse/core/storage';
import type { Logger } from '../log.ts';
import type { ShutdownStep } from '../shutdown.ts';
import { startFolder, startQueue } from './background.ts';
import type { Bind, Bindings } from './bindings.ts';
import { createLock } from './lock.ts';
import { createTaskRunner } from './startup-tasks.ts';
import { settingsNotices } from './notices.ts';
import { step } from './step.ts';

export interface LiveRuntimeOptions {
  readonly config: Config;
  readonly db: Database;
  readonly storage: Storage;
  readonly fullText: ChunkRanker;
  readonly fileUrls: FileUrls;
  readonly factories: ModelFactories;
  readonly bind: Bind;
  readonly logger: Logger;
  /** How long jobs in progress may take to finish at shutdown before they are aborted. */
  readonly graceMs: number;
  /** Puts in force the stored settings when a job was queued under newer ones. */
  readonly catchUp: () => Promise<void>;
}

export interface PrepareOptions {
  /** At startup, a failing startup task stops the start; after a save, it is retried. */
  readonly atBoot?: boolean;
}

/** The parts built from the settings in force. */
interface Active {
  readonly settings: ResolvedSettings;
  readonly embedder: ConfiguredEmbedder;
  readonly handlers: HandlerSet;
  readonly api: ApiContext;
}

/**
 * The holder of the parts the settings decide. Nothing in it runs before settings are put
 * in force: no worker, no folder watcher. Putting new settings in force swaps the parts at
 * once; a job or a request already started keeps those it started with.
 */
export interface LiveRuntime {
  /** The context of the settings in force, undefined while none are. */
  readonly api: () => ApiContext | undefined;
  /** The stored version of the settings in force, 0 while none are. */
  readonly version: () => number;
  /**
   * Builds the parts of the settings of `version`; one preparation at a time, until it is
   * settled or discarded. A version not newer than the one in force changes nothing.
   */
  readonly prepare: (
    settings: Settings,
    version: number,
    options?: PrepareOptions,
  ) => Promise<PreparedSettings>;
  /** In the order they stop: the workers, the watcher, then the embedder. */
  readonly stopSteps: readonly ShutdownStep[];
}

const NO_HANDLERS: HandlerSet = { handlers: [] };

interface Built {
  readonly next: Active;
  readonly bindings: Bindings;
}

interface Background {
  readonly queue: ShutdownStep;
  readonly folder: ShutdownStep;
}

export const createLiveRuntime = (options: LiveRuntimeOptions): LiveRuntime => {
  const { config, db, storage, factories, bind, logger } = options;
  let active: Active | undefined;
  // The version of the stored settings `active` was built from; 0 before any.
  let activeVersion = 0;
  let background: Background | undefined;
  const acquire = createLock();
  const tasks = createTaskRunner(logger);

  const activeOrFail = (): Active => {
    if (active === undefined) throw new Error('No settings are in force');
    return active;
  };

  const startBackground = async (): Promise<Background> => {
    const queue = await step('starting the workers', () =>
      startQueue({
        db,
        concurrency: config.resources.workers,
        handlers: () => active?.handlers ?? NO_HANDLERS,
        settings: { applied: () => activeVersion, catchUp: options.catchUp },
        logger,
        graceMs: options.graceMs,
      }),
    );
    const folder = startFolder({
      db,
      storage,
      dir: config.resources.watchDir,
      maxFileSize: () => activeOrFail().settings.pipeline.maxFileSize,
      logger,
    });
    return { queue, folder };
  };

  // The embedder is kept while its settings hold: a local one keeps its model process.
  const embedderFor = async (settings: ResolvedSettings): Promise<ConfiguredEmbedder> =>
    active !== undefined && isDeepStrictEqual(active.settings.embedding, settings.embedding)
      ? active.embedder
      : step('creating the embedder', () => factories.embedder(settings.embedding));

  const build = async (
    settings: ResolvedSettings,
    embedder: ConfiguredEmbedder,
  ): Promise<Built> => {
    const textModel = await step('creating the text model', () =>
      factories.textModel(settings.llm),
    );
    const visionModel = await step('creating the vision model', () =>
      factories.visionModel(settings.llm),
    );
    const bindings = bind({
      config,
      settings,
      db,
      storage,
      embedder: embedder.embedder,
      textModel,
      visionModel,
      logger,
    });
    const api: ApiContext = {
      db,
      storage,
      embedder: embedder.embedder,
      fullText: options.fullText,
      schemaLanguage: settings.pipeline.schemaLanguage,
      maxFileSize: settings.pipeline.maxFileSize,
      confidenceThreshold: settings.pipeline.confidenceThreshold,
      fileUrls: options.fileUrls,
      features: bindings.features,
    };
    const handlers = {
      handlers: bindings.handlers,
      perKindConcurrency: bindings.perKindConcurrency,
    };
    return { next: { settings, embedder, handlers, api }, bindings };
  };

  const settle = async (
    next: Active,
    previous: Active | undefined,
    bindings: Bindings,
    atBoot: boolean,
  ) => {
    if (previous !== undefined && previous.embedder !== next.embedder) {
      await previous.embedder.close();
    }
    (await settingsNotices(config, next.settings)).forEach(logger.notice);
    bindings.notices.forEach(logger.notice);
    if (atBoot) await tasks.atBoot(bindings.startupTasks);
    else await tasks.afterSave(bindings.startupTasks);
    background ??= await startBackground();
  };

  // Settings of a version this process already runs, or older, change nothing.
  const unchanged = (release: () => void): PreparedSettings => ({
    putInForce: () => undefined,
    settle: () => {
      release();
      return Promise.resolve();
    },
    discard: () => {
      release();
      return Promise.resolve();
    },
  });

  const preparedOf = (
    built: Built,
    { version, atBoot }: { readonly version: number; readonly atBoot: boolean },
    created: boolean,
    release: () => void,
  ): PreparedSettings => {
    const previous = { active, version: activeVersion };
    let inForce = false;
    return {
      putInForce: () => {
        active = built.next;
        activeVersion = version;
        inForce = true;
      },
      settle: async () => {
        try {
          await settle(built.next, previous.active, built.bindings, atBoot);
        } finally {
          release();
        }
      },
      discard: async () => {
        try {
          if (inForce) {
            active = previous.active;
            activeVersion = previous.version;
          }
          if (created) await built.next.embedder.close();
        } finally {
          release();
        }
      },
    };
  };

  const prepare = async (
    document: Settings,
    version: number,
    { atBoot = false }: PrepareOptions = {},
  ): Promise<PreparedSettings> => {
    const release = await acquire();
    try {
      if (version <= activeVersion) return unchanged(release);
      const settings = resolveSettings(document, config.embedding);
      const embedder = await embedderFor(settings);
      const created = embedder !== active?.embedder;
      const built = await build(settings, embedder).catch(async (error: unknown) => {
        if (created) await embedder.close();
        throw error;
      });
      return preparedOf(built, { version, atBoot }, created, release);
    } catch (error) {
      release();
      throw error;
    }
  };

  return {
    api: () => active?.api,
    version: () => activeVersion,
    prepare,
    stopSteps: [
      {
        name: 'startup tasks',
        run: () => {
          tasks.stop();
          return Promise.resolve();
        },
      },
      { name: 'workers', run: async () => background?.queue.run() },
      { name: 'watcher', run: async () => background?.folder.run() },
      { name: 'embedder', run: async () => active?.embedder.close() },
    ],
  };
};
