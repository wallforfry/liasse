import { eq } from 'drizzle-orm';
import { documentDates, facts } from '../db/schema/knowledge.ts';
import type { KnowledgeTrace, PersistKnowledge } from './deps.ts';

const traceColumnsOf = ({ model, schemaVersion, page, quote, confidence }: KnowledgeTrace) => ({
  model,
  schemaVersion,
  page,
  quote,
  confidence,
});

/**
 * The default `persistKnowledge`: the key dates and the facts of a document, as the
 * extraction produced them, in place of the previous ones. It resolves no subject (the
 * names a fact gives are not stored, `facts.subject_ids` stays empty), embeds no fact
 * and computes no notice deadline: the knowledge layer does, and replaces it.
 */
export const storeKnowledge: PersistKnowledge = async (
  tx,
  { id, language },
  { keyDates, facts: found },
) => {
  await tx.delete(documentDates).where(eq(documentDates.documentId, id));
  await tx.delete(facts).where(eq(facts.documentId, id));
  if (keyDates.length > 0) {
    await tx.insert(documentDates).values(
      keyDates.map((keyDate) => ({
        documentId: id,
        kind: keyDate.kind,
        date: keyDate.date,
        label: keyDate.label,
        ...traceColumnsOf(keyDate),
      })),
    );
  }
  if (found.length > 0) {
    await tx.insert(facts).values(
      found.map((fact) => ({
        documentId: id,
        text: fact.text,
        language,
        validFrom: fact.validFrom,
        validTo: fact.validTo,
        entityIds: fact.entityIds,
        ...traceColumnsOf(fact),
      })),
    );
  }
};
