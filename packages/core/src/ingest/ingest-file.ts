import { createHash } from 'node:crypto';
import type { DocumentSource } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { storageKeyOf } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { UnsupportedFormatError } from './errors.ts';
import { type IngestResult, ingestExisting, ingestNew } from './existing-document.ts';
import { lockFile } from './file-lock.ts';
import { detectMimeType } from './mime.ts';
import { type FileContent, readContent } from './read-content.ts';
import { cleanFilename, cleanHint } from './untrusted-text.ts';

export interface IngestDeps {
  readonly db: Database;
  readonly storage: Storage;
  /** In bytes; `max_file_size` of the settings. */
  readonly maxFileSize: number;
}

export type IngestInput = FileContent & {
  readonly filename: string;
  readonly source: DocumentSource;
  readonly hint?: string | undefined;
  /**
   * True flags the document `private` in the transaction that creates or revives it, so
   * no job ever sees it unflagged. On bytes that already have a live document, true
   * raises the flag and false leaves it as it is: handing a file back never lowers it.
   */
  readonly private?: boolean | undefined;
  /**
   * Whether bytes of a deleted document bring it back. Only a person handing the file
   * itself over asks for that: true by default for the API and MCP, never for the
   * watched folder. A file found inside another one, such as an email attachment,
   * passes false.
   */
  readonly revivesDeleted?: boolean;
};

/**
 * Rejects with an `IngestError` for a file that is empty, too large or of an
 * unsupported format; nothing is stored then.
 *
 * Bytes that already have a document return it (`duplicate`), after restoring its
 * stored file if it was lost and queueing it again if it had failed. Bytes of a deleted
 * document are left alone when they come from the watched folder, and revive it under
 * the same id when they come through the API or MCP.
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
  const file = {
    bytes,
    sha256,
    storageKey: storageKeyOf(sha256),
    mime,
    filename: cleanFilename(input.filename),
    source: input.source,
    hint: cleanHint(input.hint),
    private: input.private ?? false,
    revivesDeleted: input.source !== 'watch' && input.revivesDeleted !== false,
  };

  return db.transaction(async (tx) => {
    await lockFile(tx, sha256);
    const [existing] = await tx
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(eq(documents.sha256, sha256));
    return existing === undefined
      ? ingestNew(tx, storage, file)
      : ingestExisting(tx, storage, existing, file);
  });
};
