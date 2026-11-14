import type { ApiFeatures } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import type { Database } from '@liasse/core/db';
import { deriveIdentifierKey, findSensitiveIdentifiers } from '@liasse/core/entities';
import {
  createHindsightIntegration,
  describeHindsight,
  type HindsightIntegration,
} from '@liasse/core/hindsight';
import { createDeleteFileHandler, requeueFileDeletions } from '@liasse/core/ingest';
import type { RegisteredHandler } from '@liasse/core/jobs';
import { createPersistKnowledge, listSubjects, upcoming } from '@liasse/core/knowledge';
import type { Embedder, TextModel, VisionModel } from '@liasse/core/models';
import {
  correctDocument,
  createPipelineHandlers,
  failAbandonedDocuments,
  type PipelineDeps,
  reindexDocumentJob,
} from '@liasse/core/pipeline';
import type { Storage } from '@liasse/core/storage';

/** What the runtime built before it binds the features to it. */
export interface RuntimeParts {
  readonly config: Config;
  readonly db: Database;
  readonly storage: Storage;
  readonly embedder: Embedder;
  readonly textModel: TextModel;
  readonly visionModel: VisionModel;
}

export interface StartupTask {
  readonly name: string;
  readonly run: () => Promise<unknown>;
}

export interface Bindings {
  readonly handlers: readonly RegisteredHandler[];
  /** Kinds that must not run in parallel with themselves, whatever `WORKERS` says. */
  readonly perKindConcurrency: Readonly<Record<string, number>>;
  /** The use cases of the API that live in a module of their own. */
  readonly features: ApiFeatures;
  /** Run once, in order, before the workers start. */
  readonly startupTasks: readonly StartupTask[];
  /** One line each, for the operator, at startup. */
  readonly notices: readonly string[];
}

export type Bind = (parts: RuntimeParts) => Bindings;

const pipelineDepsOf = (
  { config, db, storage, embedder, textModel, visionModel }: RuntimeParts,
  hindsight: HindsightIntegration,
): PipelineDeps => {
  const identifierKey = deriveIdentifierKey(config.auth.fileUrlSecret);
  const { confidenceThreshold, maxNewTypesPerDay, schemaLanguage, maxFileSize, maxVisionPages } =
    config.pipeline;
  return {
    db,
    storage,
    embedder,
    textModel,
    visionModel,
    identifierKey,
    settings: {
      confidenceThreshold,
      maxNewTypesPerDay,
      schemaLanguage,
      maxFileSize,
      maxVisionPages,
    },
    persistKnowledge: createPersistKnowledge({ identifierKey }),
    ...(hindsight.enabled
      ? {
          afterIndexed: (id: string) => hindsight.enqueueSync(db, id),
          onPrivacyChanged: (tx, id) => hindsight.enqueueSync(tx, id),
        }
      : {}),
  };
};

const featuresOf = (deps: PipelineDeps, hindsight: HindsightIntegration): ApiFeatures => ({
  correctDocument: (input) => correctDocument(deps, input),
  listSubjects: (options) => listSubjects({ db: deps.db }, options),
  upcoming: ({ current_only: currentOnly, ...window }) =>
    upcoming({ db: deps.db }, { ...window, currentOnly }),
  ...(hindsight.enabled
    ? { onDocumentDeleted: (tx, { id }) => hindsight.enqueueSync(tx, id) }
    : {}),
});

/**
 * The one module that binds the features to the runtime. A feature that merges adds
 * its lines here and nowhere else: consolidation (`listChanges` and `applyChange` in
 * `features`) is the one left, and the notice below goes with it.
 */
export const bindFeatures: Bind = (parts) => {
  const { config, db, storage } = parts;
  const hindsight = createHindsightIntegration(config.hindsight, {
    db,
    isSensitive: (text) => findSensitiveIdentifiers(text).length > 0,
  });
  const hindsightNotice = describeHindsight(config);
  const pipeline = pipelineDepsOf(parts, hindsight);
  return {
    handlers: [
      createDeleteFileHandler({ db, storage }),
      ...createPipelineHandlers(pipeline),
      ...hindsight.handlers,
    ],
    // A re-indexing is embedding alone, and the local embedder is one model process:
    // a second one at a time would only wait inside it, holding a worker.
    perKindConcurrency: { [reindexDocumentJob.name]: 1, ...hindsight.perKindConcurrency },
    features: featuresOf(pipeline, hindsight),
    startupTasks: [
      { name: 'queueing the file removals still owed', run: () => requeueFileDeletions({ db }) },
      { name: 'failing the documents no job will process', run: () => failAbandonedDocuments(db) },
      ...(hindsight.enabled
        ? [{ name: 'queueing the Hindsight forgets still owed', run: hindsight.requeueForgets }]
        : []),
    ],
    notices: [
      'Notice: consolidation is not part of this build. Listing and applying consolidation ' +
        'changes answer 501.',
      ...(hindsightNotice === undefined ? [] : [hindsightNotice]),
    ],
  };
};
