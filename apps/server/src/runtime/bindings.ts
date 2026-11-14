import type { ApiFeatures } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import type { Database } from '@liasse/core/db';
import { findSensitiveIdentifiers } from '@liasse/core/entities';
import { createHindsightIntegration, describeHindsight } from '@liasse/core/hindsight';
import { createDeleteFileHandler, requeueFileDeletions } from '@liasse/core/ingest';
import type { RegisteredHandler } from '@liasse/core/jobs';
import type { Embedder, TextModel, VisionModel } from '@liasse/core/models';
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

/**
 * The one module that binds the features to the runtime. A feature that merges adds
 * its lines here and nowhere else:
 *
 * - the pipeline (`@liasse/core/pipeline`): `createPipelineHandlers(deps)` in
 *   `handlers`, `failAbandonedDocuments(db)` in `startupTasks`, `correctDocument` in
 *   `features`, a concurrency of 1 for its indexing kind (the embedder is one model
 *   process), `afterIndexed: (id) => hindsight.enqueueSync(db, id)` in its deps (a
 *   correction that changes `private` queues the same sync), and the notice below goes;
 * - the knowledge layer and consolidation: `listSubjects`, `upcoming`, `timeline`,
 *   `recall`, `getSubject`, `listChanges` and `applyChange` in `features`.
 */
export const bindFeatures: Bind = ({ config, db, storage }) => {
  const hindsight = createHindsightIntegration(config.hindsight, {
    db,
    isSensitive: (text) => findSensitiveIdentifiers(text).length > 0,
  });
  const hindsightNotice = describeHindsight(config);
  return {
    handlers: [createDeleteFileHandler({ db, storage }), ...hindsight.handlers],
    perKindConcurrency: { ...hindsight.perKindConcurrency },
    features: hindsight.enabled
      ? { onDocumentDeleted: (tx, { id }) => hindsight.enqueueSync(tx, id) }
      : {},
    startupTasks: [
      { name: 'queueing the file removals still owed', run: () => requeueFileDeletions({ db }) },
      ...(hindsight.enabled
        ? [{ name: 'queueing the Hindsight forgets still owed', run: hindsight.requeueForgets }]
        : []),
    ],
    notices: [
      'Notice: document processing is not part of this build. Uploaded documents are stored ' +
        'and stay "received"; correcting a document, subjects, upcoming dates and ' +
        'consolidation changes answer 501.',
      ...(hindsightNotice === undefined ? [] : [hindsightNotice]),
    ],
  };
};
