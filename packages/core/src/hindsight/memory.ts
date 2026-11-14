import { createHash } from 'node:crypto';
import type { RetainItem } from './wire.ts';

export interface SyncedDocument {
  readonly id: string;
  readonly typeSlug: string | undefined;
  /** `core.document_date`, as YYYY-MM-DD. */
  readonly documentDate: string | undefined;
}

export interface SyncedFact {
  readonly text: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

/** True for a text that still holds an identifier which must not leave Liasse. */
export type SensitiveDetector = (text: string) => boolean;

const CONTEXT = 'Facts extracted from a document by Liasse';
const SOURCE = 'liasse';

const validity = ({ validFrom, validTo }: SyncedFact): string => {
  const bounds = [
    ...(validFrom === null ? [] : [`valid_from ${validFrom}`]),
    ...(validTo === null ? [] : [`valid_to ${validTo}`]),
  ];
  return bounds.length === 0 ? '' : ` (${bounds.join(', ')})`;
};

// One fact per line, each citing its document: an agent that recalls a single memory
// still gets the id to hand to `get_document`.
const factLine = (documentId: string, fact: SyncedFact): string =>
  `[doc:${documentId}] ${fact.text.replace(/\s+/g, ' ').trim()}${validity(fact)}`;

// ISO dates sort like the days they denote. The facts hold until the latest end only
// when every one of them has an end.
const validityRange = (facts: readonly SyncedFact[]): Readonly<Record<string, string>> => {
  const starts = facts.flatMap(({ validFrom }) => (validFrom === null ? [] : [validFrom]));
  const ends = facts.flatMap(({ validTo }) => (validTo === null ? [] : [validTo]));
  return {
    ...(starts.length === 0 ? {} : { valid_from: starts.toSorted()[0] ?? '' }),
    ...(ends.length === 0 || ends.length < facts.length
      ? {}
      : { valid_to: ends.toSorted().at(-1) ?? '' }),
  };
};

export interface ScreenedFacts {
  readonly sendable: readonly SyncedFact[];
  /** How many facts the detector flagged: they are left out of what is sent. */
  readonly withheld: number;
}

// A fact is free text written by a model: nothing upstream guarantees it holds no
// identifier, so the detector is the only guard between a fact and Hindsight.
export const screenFacts = (
  facts: readonly SyncedFact[],
  isSensitive: SensitiveDetector,
): ScreenedFacts => {
  const sendable = facts.filter((fact) => !isSensitive(fact.text));
  return { sendable, withheld: facts.length - sendable.length };
};

/**
 * What Hindsight retains for a document: its screened facts and nothing else of it.
 * Undefined without a fact, which leaves nothing to retain.
 */
export const buildRetainItem = (
  document: SyncedDocument,
  sendable: readonly SyncedFact[],
): RetainItem | undefined => {
  if (sendable.length === 0) return undefined;
  return {
    content: sendable.map((fact) => factLine(document.id, fact)).join('\n'),
    document_id: document.id,
    context: CONTEXT,
    metadata: {
      source: SOURCE,
      document_id: document.id,
      ...(document.typeSlug === undefined ? {} : { type: document.typeSlug }),
      ...(document.documentDate === undefined ? {} : { document_date: document.documentDate }),
      ...validityRange(sendable),
    },
    ...(document.documentDate === undefined
      ? {}
      : { timestamp: `${document.documentDate}T00:00:00Z` }),
  };
};

export interface RetainTarget {
  readonly url: string;
  readonly bank: string;
}

/**
 * Identifies what a bank holds for a document. It covers the bank as well as the item,
 * so facts retained in one bank are not taken for retained in the one configured next.
 */
export const retainHash = ({ url, bank }: RetainTarget, item: RetainItem): string =>
  createHash('sha256').update(JSON.stringify({ url, bank, item })).digest('hex');
