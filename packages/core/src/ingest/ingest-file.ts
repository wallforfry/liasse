import { createHash } from 'node:crypto';
import type { DocumentSource } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { storageKeyOf } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { UnsupportedFormatError } from './errors.ts';
import { holdEmbedderShared } from '../settings/embedder-lock.ts';
import {
  type IngestResult,
  ingestExisting,
  ingestNew,
  type Transaction,
} from './existing-document.ts';
import { lockFile } from './file-lock.ts';
import { detectMimeType } from './mime.ts';
import { type FileContent, readContent } from './read-content.ts';
import { cleanFilename, cleanHint } from './untrusted-text.ts';

// The sources through which a person hands a file over: only they revive a deleted
// document. The watched folder and a connector hand back whatever they still hold.
const PERSON_SOURCES: ReadonlySet<DocumentSource> = new Set(['api', 'mcp']);

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
   * watched folder or a connector. A file found inside another one, such as an email
   * attachment, passes false.
   */
  readonly revivesDeleted?: boolean;
  /**
   * True when the source keeps the file: the bytes are read for their hash, type and text,
   * never written to the storage, and the document serves its file from the source. Bytes
   * that already have a stored file keep it, and bytes stored later replace the reference.
   */
  readonly byReference?: boolean;
  /**
   * Runs in the transaction of the ingestion, under the lock of the hash, once the
   * document is known: what it writes commits with the document, and a deletion of the
   * same bytes waits for it.
   */
  readonly onIngested?: (tx: Transaction, result: IngestResult) => Promise<void>;
};

/**
 * Rejects with an `IngestError` for a file that is empty, too large or of an
 * unsupported format; nothing is stored then.
 *
 * Bytes that already have a document return it (`duplicate`), after restoring its
 * stored file if it was lost and queueing it again if it had failed. Bytes of a deleted
 * document are left alone when they come from the watched folder or a connector, and
 * revive it under the same id when they come through the API or MCP.
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
    byReference: input.byReference ?? false,
    mime,
    filename: cleanFilename(input.filename),
    source: input.source,
    hint: cleanHint(input.hint),
    private: input.private ?? false,
    revivesDeleted: PERSON_SOURCES.has(input.source) && input.revivesDeleted !== false,
  };

  return db.transaction(async (tx) => {
    await lockFile(tx, sha256);
    // A document that becomes live here is indexed by the embedder in force: a save that
    // changes it waits for this transaction, or this one for that save.
    await holdEmbedderShared(tx);
    const [existing] = await tx
      .select({
        id: documents.id,
        status: documents.status,
        fileAtSource: documents.fileAtSource,
        replacedBySource: documents.replacedBySource,
      })
      .from(documents)
      .where(eq(documents.sha256, sha256));
    const result =
      existing === undefined
        ? await ingestNew(tx, storage, file)
        : await ingestExisting(tx, storage, existing, file);
    await input.onIngested?.(tx, result);
    return result;
  });
};
