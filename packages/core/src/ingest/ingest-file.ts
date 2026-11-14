import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import type { DocumentSource, DocumentStatus } from '../domain/enums.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { storageKeyOf } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { UnsupportedFormatError } from './errors.ts';
import { lockFile } from './file-lock.ts';
import { detectMimeType } from './mime.ts';
import { processDocumentJob } from './process-document-job.ts';
import { type FileContent, readContent } from './read-content.ts';
import { cleanFilename, cleanHint } from './untrusted-text.ts';

export interface IngestDeps {
  readonly db: Database;
  readonly storage: Storage;
  /** In bytes; `config.pipeline.maxFileSize`. */
  readonly maxFileSize: number;
}

export type IngestInput = FileContent & {
  readonly filename: string;
  readonly source: DocumentSource;
  readonly hint?: string | undefined;
};

export interface IngestResult {
  readonly id: string;
  readonly status: DocumentStatus;
  /** True when these bytes were already ingested: `id` is then the existing document. */
  readonly duplicate: boolean;
}

/**
 * Rejects with an `IngestError` for a file that is empty, too large or of an
 * unsupported format; nothing is stored then.
 *
 * The file is written before its row: a crash in between leaves a file without a
 * document, which the next ingestion of the same bytes overwrites, and never a
 * document without its file.
 */
export const ingestFile = async (
  { db, storage, maxFileSize }: IngestDeps,
  input: IngestInput,
): Promise<IngestResult> => {
  const bytes = await readContent(input, maxFileSize);
  const mime = detectMimeType(bytes);
  if (mime === undefined) throw new UnsupportedFormatError();
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return db.transaction(async (tx) => {
    await lockFile(tx, sha256);
    const [existing] = await tx
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(eq(documents.sha256, sha256));
    if (existing !== undefined) return { ...existing, duplicate: true };

    const storageKey = storageKeyOf(sha256);
    await storage.put(storageKey, bytes);
    const [document] = await tx
      .insert(documents)
      .values({
        sha256,
        storageKey,
        mime,
        originalName: cleanFilename(input.filename),
        source: input.source,
      })
      .returning({ id: documents.id, status: documents.status });
    if (document === undefined) throw new Error('The document was not inserted');
    const hint = cleanHint(input.hint);
    await enqueue(tx, {
      kind: processDocumentJob,
      payload: { documentId: document.id, ...(hint === undefined ? {} : { hint }) },
    });
    return { ...document, duplicate: false };
  });
};
