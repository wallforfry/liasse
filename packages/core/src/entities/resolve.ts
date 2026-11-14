import type { EntityKind } from '../domain/enums.ts';
import type { Embedder, Embedding } from '../models/ports.ts';
import { arbitrate } from './arbitrate.ts';
import {
  type Attachment,
  enrichment,
  type EntityResolution,
  exactAttachment,
  similarAttachment,
  toResolution,
} from './attachment.ts';
import { bridgeProposals, recordBridges } from './bridge-proposals.ts';
import type { EntitiesContext } from './context.ts';
import { withEntityLock } from './entity-lock.ts';
import {
  type Entity,
  type EntityReader,
  type EntityTransaction,
  insertEntity,
  loadEntities,
  similarEntities,
  type SimilarEntity,
  updateEntityNames,
} from './entity-store.ts';
import { identifiersFor, matchExact, mayDesignate } from './exact-match.ts';
import { type EntityMention, type PreparedMention, prepareMention } from './mention.ts';
import {
  decideBySimilarity,
  ENTITY_SIMILARITY,
  type SimilarityDecision,
  type SimilarityThresholds,
} from './similarity.ts';

export type { EntityResolution } from './attachment.ts';

export interface ResolveEntityOptions {
  // False for a document flagged `private`: its content must not reach an embedding
  // provider outside the installation. The similarity rule is then skipped unless the
  // embedder is local. The text model is not concerned: the flag does not keep a
  // document away from it, and extraction has given it the whole text already.
  readonly allowExternalEmbedding: boolean;
}

// The entities changed during two arbitrations in a row. Nothing was written: the caller
// resolves the mention again, as the job queue does when a job fails.
export class EntityResolutionContendedError extends Error {
  override readonly name: string = 'EntityResolutionContendedError';
}

// A mention that does not say what it is creates an organization: issuers, the most
// frequent entities, are organizations.
const DEFAULT_ENTITY_KIND: EntityKind = 'org';

// An arbitration whose candidates changed before its answer could be used is asked again
// this many times.
const ARBITRATION_RESTARTS = 1;

const ofKind = (entities: readonly Entity[], kind: EntityKind | undefined): readonly Entity[] =>
  kind === undefined ? entities : entities.filter((entity) => entity.kind === kind);

// The mention and the entity are embedded as the same kind of text: asymmetric models
// place queries and passages apart, and the thresholds compare like with like.
const embedMention = async (
  embedder: Embedder,
  { name, context }: PreparedMention,
): Promise<Embedding> => {
  const [embedding] = await embedder.embed(
    [context === undefined ? name : `${name}\n${context}`],
    'passage',
  );
  if (embedding === undefined) throw new Error('The embedder returned no embedding');
  return embedding;
};

const decideSimilarity = async (
  reader: EntityReader,
  mention: PreparedMention,
  embedding: Embedding,
  thresholds: SimilarityThresholds,
): Promise<SimilarityDecision<SimilarEntity>> => {
  const similar = await similarEntities(reader, embedding, mention.kind, thresholds.arbitrate);
  // An entity the mention cannot designate is left out before the closest are kept, so
  // that namesakes with another company id do not hide the one it may be.
  return decideBySimilarity(
    similar.filter(({ entity }) => mayDesignate(mention)(entity)),
    thresholds,
  );
};

type ResolutionDeps = Pick<EntitiesContext, 'db' | 'textModel'> & {
  readonly similarity: SimilarityThresholds;
};

interface Verdict {
  // The candidates the text model was given, closest first.
  readonly offered: readonly string[];
  readonly chosen: string | undefined;
}

const idsOf = (candidates: readonly SimilarEntity[]): readonly string[] =>
  candidates.map(({ entity }) => entity.id);

// The text model may take minutes to answer: it is asked before the lock is taken, about
// the candidates as they are then, so that no other entity write waits for it.
const arbitrateOutsideLock = async (
  { db, textModel, similarity }: ResolutionDeps,
  mention: PreparedMention,
  embedding: Embedding | undefined,
): Promise<Verdict | undefined> => {
  if (embedding === undefined) return undefined;
  if (matchExact(ofKind(await loadEntities(db), mention.kind), mention) !== undefined) {
    return undefined;
  }
  const decision = await decideSimilarity(db, mention, embedding, similarity);
  if (decision.outcome !== 'arbitrate') return undefined;
  const chosen = await arbitrate(textModel, mention, decision.candidates);
  return { offered: idsOf(decision.candidates), chosen: chosen?.entity.id };
};

const RESTART = 'restart';

// The answer of the text model holds only for the candidates it was given. When they are
// no longer the candidates, the arbitration is to do again.
const bySimilarity = async (
  tx: EntityTransaction,
  mention: PreparedMention,
  embedding: Embedding,
  verdict: Verdict | undefined,
  thresholds: SimilarityThresholds,
): Promise<Attachment | typeof RESTART | undefined> => {
  const decision = await decideSimilarity(tx, mention, embedding, thresholds);
  if (decision.outcome === 'none') return undefined;
  if (decision.outcome === 'attach') {
    return similarAttachment(decision.candidate, 'similarity', [mention.name]);
  }
  if (verdict?.offered.join() !== idsOf(decision.candidates).join()) {
    return RESTART;
  }
  const chosen = decision.candidates.find(({ entity }) => entity.id === verdict.chosen);
  return chosen === undefined ? undefined : similarAttachment(chosen, 'arbitration', []);
};

const resolveUnderLock = async (
  tx: EntityTransaction,
  mention: PreparedMention,
  embedding: Embedding | undefined,
  verdict: Verdict | undefined,
  thresholds: SimilarityThresholds,
): Promise<EntityResolution | typeof RESTART> => {
  const everyEntity = await loadEntities(tx);
  const exact = matchExact(ofKind(everyEntity, mention.kind), mention);
  const similar =
    exact === undefined && embedding !== undefined
      ? await bySimilarity(tx, mention, embedding, verdict, thresholds)
      : undefined;
  if (similar === RESTART) return RESTART;
  const attachment = exact === undefined ? similar : exactAttachment(exact);
  if (attachment === undefined) {
    const created = await insertEntity(tx, {
      kind: mention.kind ?? DEFAULT_ENTITY_KIND,
      canonicalName: mention.name,
      identifiers: identifiersFor(undefined, everyEntity, mention.identifiers),
      embedding,
    });
    await recordBridges(tx, everyEntity, mention, created);
    return { entity_id: created.id, match: 'created', confidence: 1 };
  }
  const gained = enrichment(attachment, mention, everyEntity);
  if (gained !== undefined) await updateEntityNames(tx, attachment.entity.id, gained);
  await recordBridges(tx, everyEntity, mention, attachment.entity);
  return toResolution(attachment);
};

const resolveWithModels = async (
  deps: ResolutionDeps,
  mention: PreparedMention,
  embedding: Embedding | undefined,
  restarts: number,
): Promise<EntityResolution> => {
  const verdict = await arbitrateOutsideLock(deps, mention, embedding);
  const resolution = await withEntityLock(deps.db, (tx) =>
    resolveUnderLock(tx, mention, embedding, verdict, deps.similarity),
  );
  if (resolution !== RESTART) return resolution;
  if (restarts === 0) {
    throw new EntityResolutionContendedError(
      'The entities close to the mention kept changing while the text model was asked about them.',
    );
  }
  return resolveWithModels(deps, mention, embedding, restarts - 1);
};

// Attaches a mention to the entity it designates, creating the entity when none does:
// strong identifier, then normalized name, then similarity, in that order.
export const resolveEntity = async (
  { db, embedder, textModel, identifierKey, similarity = ENTITY_SIMILARITY }: EntitiesContext,
  mention: EntityMention,
  { allowExternalEmbedding }: ResolveEntityOptions,
): Promise<EntityResolution> => {
  const prepared = prepareMention(identifierKey, mention);
  // Most mentions name an entity already known, bring nothing new and say nothing of
  // another entity: they are answered from one read, without the lock and without a model.
  const everyEntity = await loadEntities(db);
  const known = matchExact(ofKind(everyEntity, prepared.kind), prepared);
  if (known !== undefined) {
    const attachment = exactAttachment(known);
    const nothingToWrite =
      enrichment(attachment, prepared, everyEntity) === undefined &&
      bridgeProposals(everyEntity, prepared, known.entity).length === 0;
    if (nothingToWrite) return toResolution(attachment);
  }
  // Both models may be remote calls: they run before the lock is taken, and what they
  // answered is checked again under it.
  const embedding =
    embedder.isLocal || allowExternalEmbedding ? await embedMention(embedder, prepared) : undefined;
  return resolveWithModels(
    { db, textModel, similarity },
    prepared,
    embedding,
    ARBITRATION_RESTARTS,
  );
};
