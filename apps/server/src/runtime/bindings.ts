import type { ApiFeatures } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import {
  applyChange,
  CONSOLIDATION_CONCURRENCY,
  createConsolidationHandlers,
  listChanges,
  listConsolidationRuns,
  queueBatchRunIfDue,
  requestConsolidationRun,
  scheduleNightlyRun,
} from '@liasse/core/consolidation';
import type { Database } from '@liasse/core/db';
import { ENTITY_ARBITRATION_CANDIDATES } from '@liasse/contract/domain';
import { deriveIdentifierKey, findSensitiveIdentifiers } from '@liasse/core/entities';
import {
  createHindsightIntegration,
  describeHindsight,
  type HindsightIntegration,
} from '@liasse/core/hindsight';
import { createDeleteFileHandler, requeueFileDeletions } from '@liasse/core/ingest';
import type { RegisteredHandler } from '@liasse/core/jobs';
import {
  createKnowledgeHandlers,
  getSubject,
  listSubjects,
  recall,
  timeline,
  upcoming,
} from '@liasse/core/knowledge';
import type { Embedder, TextModel, VisionModel } from '@liasse/core/models';
import {
  correctDocument,
  createPipelineHandlers,
  failAbandonedDocuments,
  type PipelineDeps,
  type PipelineSettings,
  suggestType,
} from '@liasse/core/pipeline';
import type { Storage } from '@liasse/core/storage';
import type { Logger } from '../log.ts';

/** What the runtime built before it binds the features to it. */
export interface RuntimeParts {
  readonly config: Config;
  readonly db: Database;
  readonly storage: Storage;
  readonly embedder: Embedder;
  readonly textModel: TextModel;
  readonly visionModel: VisionModel;
  readonly logger: Logger;
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

export const pipelineSettingsOf = ({
  confidenceThreshold,
  maxNewTypesPerDay,
  schemaLanguage,
  maxFileSize,
  maxVisionPages,
  entitySimilarity,
}: Config['pipeline']): PipelineSettings => ({
  confidenceThreshold,
  maxNewTypesPerDay,
  schemaLanguage,
  maxFileSize,
  maxVisionPages,
  entitySimilarity: { ...entitySimilarity, candidates: ENTITY_ARBITRATION_CANDIDATES },
});

const pipelineDepsOf = (
  { config, db, storage, embedder, textModel, visionModel }: RuntimeParts,
  hindsight: HindsightIntegration,
): PipelineDeps => {
  const identifierKey = deriveIdentifierKey(config.auth.fileUrlSecret);
  return {
    db,
    storage,
    embedder,
    textModel,
    visionModel,
    identifierKey,
    settings: pipelineSettingsOf(config.pipeline),
    // Consolidation counts the documents settled since its last run, and runs again
    // after every batch of them.
    afterIndexed: async (id: string) => {
      if (hindsight.enabled) await hindsight.enqueueSync(db, id);
      await queueBatchRunIfDue(db);
    },
    ...(hindsight.enabled ? { onPrivacyChanged: (tx, id) => hindsight.enqueueSync(tx, id) } : {}),
  };
};

const featuresOf = (deps: PipelineDeps, hindsight: HindsightIntegration): ApiFeatures => ({
  correctDocument: (input) => correctDocument(deps, input),
  suggestType: (request) => suggestType(deps, request),
  listSubjects: (options) => listSubjects({ db: deps.db }, options),
  upcoming: ({ current_only: currentOnly, ...window }) =>
    upcoming({ db: deps.db }, { ...window, currentOnly }),
  timeline: (input) => timeline({ db: deps.db }, input),
  recall: (input) => recall({ db: deps.db, embedder: deps.embedder }, input),
  getSubject: (input) => getSubject({ db: deps.db }, input),
  listChanges: (options) => listChanges({ db: deps.db }, options),
  applyChange: (id, decision) => applyChange({ db: deps.db }, id, decision),
  requestConsolidationRun: () => requestConsolidationRun({ db: deps.db }),
  listConsolidationRuns: () => listConsolidationRuns({ db: deps.db }),
  ...(hindsight.enabled
    ? { onDocumentDeleted: (tx, { id }) => hindsight.enqueueSync(tx, id) }
    : {}),
});

/**
 * The one module that binds the features to the runtime. A feature that merges adds
 * its lines here and nowhere else.
 */
export const bindFeatures: Bind = (parts) => {
  const { config, db, storage, logger } = parts;
  const hindsight = createHindsightIntegration(config.hindsight, {
    db,
    isSensitive: (text) => findSensitiveIdentifiers(text).length > 0,
    // A count only: the id of the document would tell which one holds an account or a
    // card number.
    onFactsWithheld: ({ count }) => {
      logger.event('hindsight_facts_withheld', { count });
    },
  });
  const hindsightNotice = describeHindsight(config);
  const pipeline = pipelineDepsOf(parts, hindsight);
  return {
    handlers: [
      createDeleteFileHandler({ db, storage }),
      ...createPipelineHandlers(pipeline),
      ...createKnowledgeHandlers({ db, textModel: parts.textModel }),
      ...createConsolidationHandlers({
        db,
        textModel: parts.textModel,
        autoApply: config.pipeline.autoApply,
        schemaLanguage: config.pipeline.schemaLanguage,
      }),
      ...hindsight.handlers,
    ],
    perKindConcurrency: { ...hindsight.perKindConcurrency, ...CONSOLIDATION_CONCURRENCY },
    features: featuresOf(pipeline, hindsight),
    startupTasks: [
      { name: 'queueing the file removals still owed', run: () => requeueFileDeletions({ db }) },
      { name: 'failing the documents no job will process', run: () => failAbandonedDocuments(db) },
      { name: 'queueing the nightly consolidation', run: () => scheduleNightlyRun(db) },
      ...(hindsight.enabled
        ? [{ name: 'queueing the Hindsight forgets still owed', run: hindsight.requeueForgets }]
        : []),
    ],
    notices: hindsightNotice === undefined ? [] : [hindsightNotice],
  };
};
