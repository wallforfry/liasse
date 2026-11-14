import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import type { DocumentStatus } from '../domain/enums.ts';
import {
  PIPELINE_PROVENANCE_KEY,
  type PipelineProvenance,
  readPipelineProvenance,
} from '../domain/provenance.ts';
import type { Transaction } from '../ingest/existing-document.ts';
import { writeIfLive } from '../ingest/live-write.ts';

export type Reader = Database | Transaction;

/** Indexed and queryable; `needs_review` is also flagged for a person to look at. */
export const SETTLED_STATUSES: readonly DocumentStatus[] = ['indexed', 'needs_review'];

const DOCUMENT_COLUMNS = {
  id: documents.id,
  status: documents.status,
  source: documents.source,
  originalName: documents.originalName,
  hint: documents.hint,
  private: documents.private,
  typeId: documents.typeId,
  schemaVersion: documents.schemaVersion,
  core: documents.core,
  fields: documents.fields,
  extra: documents.extra,
  provenance: documents.provenance,
  title: documents.title,
  summary: documents.summary,
  confidence: documents.confidence,
  manualFields: documents.manualFields,
  error: documents.error,
} as const;

export type PipelineDocument = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

/** Undefined for a document that does not exist or is a tombstone. */
export const loadDocument = async (reader: Reader, id: string) => {
  const [document] = await reader
    .select(DOCUMENT_COLUMNS)
    .from(documents)
    .where(and(eq(documents.id, id), isLiveDocument));
  return document;
};

export const withPipelineProvenance = (
  provenance: JsonObject,
  patch: PipelineProvenance,
): JsonObject => ({
  ...provenance,
  [PIPELINE_PROVENANCE_KEY]: { ...readPipelineProvenance(provenance), ...patch },
});

// A stage writes only over the status it started from. Two jobs for one document may
// both do the work of a stage; the row lock of `writeIfLive` lets one of them write it.
// Resolves to whether it wrote.
export const writeFromStatus = async (
  db: Reader,
  documentId: string,
  expected: readonly DocumentStatus[],
  write: (tx: Transaction, document: PipelineDocument) => Promise<void>,
): Promise<boolean> => {
  const outcome = await writeIfLive(db, documentId, async (tx) => {
    const document = await loadDocument(tx, documentId);
    if (document === undefined || !expected.includes(document.status)) return false;
    await write(tx, document);
    return true;
  });
  return outcome.written && outcome.result;
};
