import { and, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { jobs, unfinishedJobOfDocument } from '../db/schema/jobs.ts';
import type { Transaction } from '../ingest/existing-document.ts';
import { processDocumentJob } from '../ingest/process-document-job.ts';
import { reclassifyDocumentJob, reextractDocumentJob } from './jobs.ts';

// The jobs that write the type or the fields of a document once it is settled.
const WRITING_KINDS = [processDocumentJob, reextractDocumentJob, reclassifyDocumentJob].map(
  ({ name }) => name,
);

/** Whether a job that writes the type or the fields of the document is queued or running. */
export const hasPendingWrite = async (
  db: Database | Transaction,
  documentId: string,
): Promise<boolean> => {
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.kind, WRITING_KINDS), unfinishedJobOfDocument(documentId)))
    .limit(1);
  return pending !== undefined;
};
