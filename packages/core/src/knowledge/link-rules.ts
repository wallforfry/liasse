import type { LinkKind } from '../domain/enums.ts';
import { MIN_LINK_CONFIDENCE } from '../domain/limits.ts';
import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import type { LinkDocument } from './link-candidates.ts';
import type { ProposedLink } from './link-prompt.ts';

export interface ValidLink {
  readonly fromDocumentId: string;
  readonly toDocumentId: string;
  readonly kind: LinkKind;
  readonly confidence: number;
  readonly rationale: string;
}

interface Oriented extends ValidLink {
  readonly from: LinkDocument;
  readonly to: LinkDocument;
}

// A document cannot replace, change, end or answer one written after it. A payment may
// come before its invoice, and an attachment has no order.
const FOLLOWS_ITS_TARGET: readonly LinkKind[] = [
  'supersedes',
  'amends',
  'terminates',
  'replies_to',
];

// Checked on the dates the documents state: the day one was ingested says nothing of
// when it was written.
const respectsChronology = ({ kind, from, to }: Oriented): boolean =>
  !FOLLOWS_ITS_TARGET.includes(kind) ||
  from.statedDate === null ||
  to.statedDate === null ||
  from.statedDate >= to.statedDate;

// Half a cent: amounts are decimal numbers held as doubles.
const AMOUNT_TOLERANCE = 0.005;

// A payment settles all or part of what it pays, in its currency. Checked only when both
// amounts are known.
const paysCompatibly = ({ kind, from, to }: Oriented): boolean =>
  kind !== 'pays' ||
  from.amount === null ||
  to.amount === null ||
  (from.amount.currency === to.amount.currency &&
    Math.abs(from.amount.value) <= Math.abs(to.amount.value) + AMOUNT_TOLERANCE);

const samePair = (left: ValidLink, right: ValidLink): boolean =>
  (left.fromDocumentId === right.fromDocumentId && left.toDocumentId === right.toDocumentId) ||
  (left.fromDocumentId === right.toDocumentId && left.toDocumentId === right.fromDocumentId);

const SUPERSEDES = 'supersedes' satisfies LinkKind;

// Whether a link may be kept next to those already kept, which are surer than it. Two
// documents have one link of a kind, in one direction: A cannot supersede B while B
// supersedes A. And a document supersedes one document, and is superseded by one: the
// model saying it replaces three contracts is guessing.
const fitsWith =
  (kept: readonly ValidLink[], sourceId: string) =>
  (link: ValidLink): boolean =>
    !kept.some(
      (other) =>
        other.kind === link.kind &&
        (samePair(other, link) ||
          (link.kind === SUPERSEDES &&
            ((link.fromDocumentId === sourceId && other.fromDocumentId === sourceId) ||
              (link.toDocumentId === sourceId && other.toDocumentId === sourceId)))),
    );

/**
 * The links worth storing among those the text model proposed for a document: between
 * the document and a candidate that was offered, sure enough, in an order their dates
 * allow, with amounts a payment can settle, and consistent with each other, the surest
 * first. Cycles through other documents are checked when the link is written, under the
 * lock of the links. The rationale is model text: an IBAN or a card number in it is
 * masked.
 */
export const validateLinks = (
  source: LinkDocument,
  candidates: readonly LinkDocument[],
  proposals: readonly ProposedLink[],
): readonly ValidLink[] => {
  const offered = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return proposals
    .flatMap(({ candidate: candidateId, kind, actor, confidence, rationale }) => {
      const candidate = offered.get(candidateId);
      if (candidate === undefined || candidate.id === source.id) return [];
      const [from, to] = actor === 'document' ? [source, candidate] : [candidate, source];
      return [
        {
          fromDocumentId: from.id,
          toDocumentId: to.id,
          kind,
          confidence,
          rationale: redactSensitiveIdentifiers(rationale),
          from,
          to,
        },
      ];
    })
    .filter(({ confidence }) => confidence >= MIN_LINK_CONFIDENCE)
    .filter(respectsChronology)
    .filter(paysCompatibly)
    .map(({ from: _from, to: _to, ...link }) => link)
    .toSorted((left, right) => right.confidence - left.confidence)
    .reduce<readonly ValidLink[]>(
      (kept, link) => (fitsWith(kept, source.id)(link) ? [...kept, link] : kept),
      [],
    );
};
