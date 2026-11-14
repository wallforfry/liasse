import type { IdentifierKey } from '../entities/sensitive.ts';
import type { Embedder, Embedding } from '../models/ports.ts';
import type { KnowledgeContext } from './context.ts';
import { type PreparedFact, prepareFact } from './facts.ts';
import { type KnowledgeDocument, type KnowledgeInput, parseKnowledge } from './input.ts';
import { type KeyDateRow, planKeyDates } from './key-dates.ts';
import { arbitrateOutsideLock, type ResolvableSubject } from './resolve-subject.ts';
import { prepareSubjectMentions } from './subject-mention.ts';

// The knowledge of a document, validated and masked, with what the models said about it:
// everything `persistKnowledge` needs, so that it calls no model inside the transaction
// of the document.
export interface PreparedKnowledge {
  readonly prepared: true;
  readonly keyDates: readonly KeyDateRow[];
  readonly facts: readonly PreparedFact[];
  // One embedding per fact, in order. Undefined when none was computed.
  readonly factEmbeddings: readonly Embedding[] | undefined;
  readonly subjects: readonly ResolvableSubject[];
  // True when the embeddings come from a provider outside the installation: they are not
  // stored if the document turns out to be private once its row is locked.
  readonly embeddedExternally: boolean;
}

/**
 * The part of the preparation that needs no model: validation, the computed notice
 * deadline, masking. Knowledge prepared this way only is stored like the knowledge of a
 * private document under an external embedding provider: subjects are resolved by
 * identifier and label alone, and facts are found by full text only.
 */
export const prepareWithoutModels = (
  identifierKey: IdentifierKey,
  input: KnowledgeInput,
): PreparedKnowledge => {
  const knowledge = parseKnowledge(input);
  return {
    prepared: true,
    keyDates: planKeyDates(knowledge.keyDates, knowledge.noticePeriod),
    facts: knowledge.facts.map(prepareFact),
    factEmbeddings: undefined,
    subjects: prepareSubjectMentions(identifierKey, knowledge.subjects).map((mention) => ({
      mention,
      embedding: undefined,
      verdict: undefined,
    })),
    embeddedExternally: false,
  };
};

const embedAll = async (
  embedder: Embedder,
  texts: readonly string[],
): Promise<readonly Embedding[]> => {
  if (texts.length === 0) return [];
  const embeddings = await embedder.embed(texts, 'passage');
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedder ${embedder.model} returned ${String(embeddings.length)} embeddings ` +
        `for ${String(texts.length)} texts`,
    );
  }
  return embeddings;
};

/**
 * Prepares the knowledge of a document outside any transaction: the embeddings of its
 * facts and of its candidate subjects, and the answer of the text model for a candidate
 * that only similarity can attach. Nothing is written.
 *
 * A private document never reaches an embedding provider outside the installation: its
 * facts get no embedding and its subjects skip the similarity rule. The text model is
 * not concerned: the flag does not keep a document away from it, and extraction has
 * given it the whole text already.
 */
export const prepareKnowledge = async (
  { db, embedder, textModel, identifierKey }: KnowledgeContext,
  document: KnowledgeDocument,
  input: KnowledgeInput,
): Promise<PreparedKnowledge> => {
  const offline = prepareWithoutModels(identifierKey, input);
  if (document.private && !embedder.isLocal) return offline;
  const mentions = offline.subjects.map(({ mention }) => mention);
  const embeddings = await embedAll(embedder, [
    ...mentions.map(({ name }) => name),
    ...offline.facts.map(({ text }) => text),
  ]);
  const subjects: ResolvableSubject[] = [];
  for (const [index, mention] of mentions.entries()) {
    const embedding = embeddings[index];
    subjects.push({
      mention,
      embedding,
      verdict: await arbitrateOutsideLock({ db, textModel }, mention, embedding),
    });
  }
  return {
    ...offline,
    factEmbeddings: embeddings.slice(mentions.length),
    subjects,
    embeddedExternally: !embedder.isLocal,
  };
};
