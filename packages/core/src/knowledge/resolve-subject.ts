import type { EntityMatchRule } from '../domain/enums.ts';
import {
  decideBySimilarity,
  ENTITY_SIMILARITY,
  type SimilarityDecision,
} from '../entities/similarity.ts';
import type { Embedding, TextModel } from '../models/ports.ts';
import { arbitrateSubject } from './subject-arbitrate.ts';
import { type Attachment, enrichSubject, type SubjectOrigin } from './subject-enrichment.ts';
import { scopedToIssuer } from './subject-identifiers.ts';
import { isDistinctiveLabel } from './subject-label.ts';
import {
  matchSubjectExactly,
  mayDesignateSubject,
  subjectIdentifiersFor,
} from './subject-match.ts';
import type { SubjectMention } from './subject-mention.ts';
import {
  insertSubject,
  loadSubjects,
  type SimilarSubject,
  similarSubjects,
  type SubjectReader,
  type SubjectTransaction,
} from './subject-store.ts';

// What the text model answered about a mention, and about which candidates.
export interface SubjectVerdict {
  // The candidates the text model was given, closest first.
  readonly offered: readonly string[];
  readonly chosen: string | undefined;
}

// A mention with what the models said about it, computed before any lock is taken.
export interface ResolvableSubject {
  readonly mention: SubjectMention;
  // Undefined for a private document under an embedding provider outside the installation,
  // and for knowledge that was not prepared: the similarity rule is then skipped.
  readonly embedding: Embedding | undefined;
  readonly verdict: SubjectVerdict | undefined;
}

export interface SubjectResolution {
  readonly subjectId: string;
  readonly match: EntityMatchRule;
  readonly confidence: number;
}

// Subjects are resolved like entities, on the thresholds of the specification.
const decideSimilarity = async (
  reader: SubjectReader,
  mention: SubjectMention,
  embedding: Embedding,
): Promise<SimilarityDecision<SimilarSubject>> => {
  if (!isDistinctiveLabel(mention.name)) return { outcome: 'none' };
  const similar = await similarSubjects(
    reader,
    embedding,
    mention.kind,
    ENTITY_SIMILARITY.arbitrate,
  );
  // A subject the mention cannot designate is left out before the closest are kept, so
  // that a namesake with another plate does not hide the one it may be.
  return decideBySimilarity(
    similar.filter(({ subject }) => mayDesignateSubject(mention)(subject)),
    ENTITY_SIMILARITY,
  );
};

const idsOf = (candidates: readonly SimilarSubject[]): readonly string[] =>
  candidates.map(({ subject }) => subject.id);

interface ArbitrationDeps {
  readonly db: SubjectReader;
  readonly textModel: TextModel;
}

/**
 * Asks the text model about a mention that only similarity can attach, before any lock
 * is taken: the model may take minutes, and its answer is about the candidates as they
 * are now. `resolveSubjectUnderLock` uses it only if they are still the candidates.
 */
export const arbitrateOutsideLock = async (
  { db, textModel }: ArbitrationDeps,
  mention: SubjectMention,
  embedding: Embedding | undefined,
): Promise<SubjectVerdict | undefined> => {
  if (embedding === undefined) return undefined;
  if (matchSubjectExactly(await loadSubjects(db, mention.kind), mention) !== undefined) {
    return undefined;
  }
  const decision = await decideSimilarity(db, mention, embedding);
  if (decision.outcome !== 'arbitrate') return undefined;
  const chosen = await arbitrateSubject(textModel, mention, decision.candidates);
  return { offered: idsOf(decision.candidates), chosen: chosen?.subject.id };
};

// Normalization drops case and accents, so an equal label is not quite an identity.
const EXACT_CONFIDENCE = { identifier: 1, name: 0.99, alias: 0.99 } as const;

// The verdict of the text model holds for the candidates it was given. When they changed
// before the lock was taken, or when nobody asked, the mention attaches to none of them:
// the model cannot be asked again inside the transaction of a document, and a duplicate
// can be merged where a wrong fusion cannot be undone.
const bySimilarity = async (
  tx: SubjectTransaction,
  { mention, embedding, verdict }: ResolvableSubject,
): Promise<Attachment | undefined> => {
  if (embedding === undefined) return undefined;
  const decision = await decideSimilarity(tx, mention, embedding);
  if (decision.outcome === 'none') return undefined;
  if (decision.outcome === 'attach') {
    const { subject, similarity } = decision.candidate;
    return {
      subject,
      match: 'similarity',
      confidence: Math.min(1, similarity),
      aliases: [mention.name],
    };
  }
  if (verdict?.offered.join() !== idsOf(decision.candidates).join()) return undefined;
  const chosen = decision.candidates.find(({ subject }) => subject.id === verdict.chosen);
  return chosen === undefined
    ? undefined
    : {
        subject: chosen.subject,
        match: 'arbitration',
        confidence: Math.min(1, chosen.similarity),
        aliases: [],
      };
};

/**
 * Attaches a mention to the subject it designates, creating the subject when none does:
 * identifier, then normalized label, then similarity, in that order. Runs under the
 * subject lock, in the transaction that writes the subject id it answers with. What the
 * mention adds to the subject depends on its document (see `enrichSubject`); a subject a
 * private document creates is private.
 */
export const resolveSubjectUnderLock = async (
  tx: SubjectTransaction,
  resolvable: ResolvableSubject,
  origin: SubjectOrigin,
): Promise<SubjectResolution> => {
  const { embedding } = resolvable;
  const mention = {
    ...resolvable.mention,
    identifiers: scopedToIssuer(resolvable.mention.identifiers, origin.issuerId),
  };
  const everySubject = await loadSubjects(tx);
  const exact = matchSubjectExactly(
    everySubject.filter(({ kind }) => kind === mention.kind),
    mention,
  );
  const attachment: Attachment | undefined =
    exact === undefined
      ? await bySimilarity(tx, { ...resolvable, mention })
      : { ...exact, confidence: EXACT_CONFIDENCE[exact.match], aliases: [] };
  if (attachment === undefined) {
    const created = await insertSubject(tx, {
      kind: mention.kind,
      canonicalName: mention.name,
      identifiers: subjectIdentifiersFor(undefined, everySubject, mention.identifiers),
      embedding,
      private: origin.private,
    });
    return { subjectId: created.id, match: 'created', confidence: 1 };
  }
  await enrichSubject(tx, attachment, mention, everySubject, { origin, embedding });
  return {
    subjectId: attachment.subject.id,
    match: attachment.match,
    confidence: attachment.confidence,
  };
};
