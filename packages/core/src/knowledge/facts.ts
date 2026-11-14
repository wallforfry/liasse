import { eq } from 'drizzle-orm';
import { facts } from '../db/schema/knowledge.ts';
import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import type { EntityTransaction } from '../entities/entity-store.ts';
import type { Embedding } from '../models/ports.ts';
import type { KnowledgeFact } from './input.ts';
import { subjectLabelKey } from './subject-label.ts';

// A fact ready to be stored, but for the ids of its subjects, which are only known under
// the subject lock.
export interface PreparedFact {
  readonly text: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly entityIds: readonly string[];
  // The labels of the subjects the fact names, normalized like those of the candidates.
  readonly subjectLabelKeys: readonly string[];
  readonly model: string;
  readonly schemaVersion: number | null;
  readonly page: number;
  readonly quote: string;
  readonly confidence: number;
}

/**
 * A fact is free text written by a model: the last place where an IBAN or a card number
 * can slip into a column that is searched, returned by `recall` and exported. It is
 * masked rather than dropped: the fact still says what happened, and nothing of the
 * number but its last characters is kept. Its quote, which is document text, is masked
 * the same way.
 */
export const prepareFact = ({ subjects, ...fact }: KnowledgeFact): PreparedFact => ({
  ...fact,
  text: redactSensitiveIdentifiers(fact.text),
  quote: redactSensitiveIdentifiers(fact.quote),
  entityIds: [...new Set(fact.entityIds)],
  subjectLabelKeys: [...new Set(subjects.map(subjectLabelKey))],
});

export interface FactRow extends Omit<PreparedFact, 'subjectLabelKeys'> {
  readonly subjectIds: readonly string[];
  // Null for a private document under an embedding provider outside the installation: the
  // fact is then found by full text only.
  readonly embedding: Embedding | null;
}

// Replaces the facts of a document, in the language of the document. The caller holds
// the row of the document and the subject lock.
export const replaceFacts = async (
  tx: EntityTransaction,
  documentId: string,
  language: string | null,
  rows: readonly FactRow[],
): Promise<void> => {
  await tx.delete(facts).where(eq(facts.documentId, documentId));
  if (rows.length === 0) return;
  await tx.insert(facts).values(rows.map((row) => ({ ...row, documentId, language })));
};
