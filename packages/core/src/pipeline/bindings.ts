import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import { withEntityLock } from '../entities/entity-lock.ts';
import { missingEntityIds } from '../entities/entity-store.ts';
import { InvalidEntityMentionError, prepareMention } from '../entities/mention.ts';
import { resolveEntity } from '../entities/resolve.ts';
import { createPersistKnowledge } from '../knowledge/persist-knowledge.ts';
import { indexDocument } from '../search/indexing.ts';
import type {
  EntityResolver,
  IndexDocument,
  MaskSensitive,
  PersistKnowledge,
  PipelineDeps,
} from './deps.ts';

// The one place the pipeline is bound to entity resolution, masking, indexing and the
// knowledge store. Each
// accessor answers what the caller injected, or the real function.

const realEntities = ({
  db,
  embedder,
  textModel,
  identifierKey,
  settings,
}: PipelineDeps): EntityResolver => {
  const context = {
    db,
    embedder,
    textModel,
    identifierKey,
    ...(settings.entitySimilarity === undefined ? {} : { similarity: settings.entitySimilarity }),
  };
  return {
    // A mention the resolver refuses says something of the output of the model, not of
    // the installation: the value that carries it is dropped. A contended resolution is
    // thrown on: it wrote nothing and another attempt of the job can succeed.
    resolve: async ({ identifiers, ...mention }, options) => {
      const complete = {
        ...mention,
        ...(identifiers === undefined ? {} : { identifiers: [...identifiers] }),
      };
      try {
        const { droppedIdentifiers } = prepareMention(identifierKey, complete);
        return {
          provenance: await resolveEntity(context, complete, options),
          droppedIdentifiers: droppedIdentifiers.empty + droppedIdentifiers.malformed,
        };
      } catch (error) {
        if (error instanceof InvalidEntityMentionError) return undefined;
        throw error;
      }
    },
    withLock: withEntityLock,
    missingIds: missingEntityIds,
  };
};

export const entitiesOf = (deps: PipelineDeps): EntityResolver =>
  deps.entities ?? realEntities(deps);

// The detector masks whole matches as it reports them.
export const maskOf = (deps: PipelineDeps): MaskSensitive =>
  deps.maskSensitive ?? redactSensitiveIdentifiers;

export const indexerOf = (deps: PipelineDeps): IndexDocument =>
  deps.indexDocument ?? ((documentId) => indexDocument(deps, documentId));

export const persisterOf = (deps: PipelineDeps): PersistKnowledge =>
  deps.persistKnowledge ??
  createPersistKnowledge({
    identifierKey: deps.identifierKey,
    ...(deps.settings.entitySimilarity === undefined
      ? {}
      : { similarity: deps.settings.entitySimilarity }),
  });
