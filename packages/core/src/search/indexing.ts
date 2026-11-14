import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chunks, documentPages, documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { languageCodeSchema } from '../domain/values.ts';
import { batchesOf } from '../models/batching.ts';
import type { Embedder, Embedding } from '../models/ports.ts';
import { chunkingFor } from './chunk-budget.ts';
import { type Chunk, chunkPages, embeddingInput } from './chunking.ts';

const EMBEDDING_BATCH_SIZE = 32;

// Postgres accepts 65,535 bind parameters per statement; a chunk row uses six.
const INSERT_BATCH_SIZE = 1000;

const MAX_ATTEMPTS = 3;

export interface IndexingDeps {
  readonly db: Database;
  readonly embedder: Embedder;
}

export interface IndexingResult {
  readonly chunkCount: number;
  readonly embedded: boolean;
}

export class DocumentNotFoundError extends Error {
  override readonly name = 'DocumentNotFoundError';
  readonly documentId: string;

  constructor(documentId: string) {
    super(`Document ${documentId} does not exist`);
    this.documentId = documentId;
  }
}

// The document was rewritten during every attempt to index it. Nothing was stored: the
// previous chunks are intact and a later run can succeed.
export class IndexingConflictError extends Error {
  override readonly name = 'IndexingConflictError';
  readonly retryable = true;
  readonly documentId: string;

  constructor(documentId: string) {
    super(
      `Document ${documentId} changed during each of the ${String(MAX_ATTEMPTS)} attempts ` +
        'to index it',
    );
    this.documentId = documentId;
  }
}

// Either the database or a transaction on it.
type Reader = Pick<Database, 'select'>;

// Everything the chunks are derived from. Its fingerprint tells whether the chunks computed
// from one read still describe the document at the time they are stored. No column is bumped
// by every writer of the pages, so a version number could not be trusted for this.
interface Source {
  readonly title: string | null;
  readonly typeSlug: string | null;
  readonly private: boolean;
  readonly language: string | null;
  readonly pages: readonly { readonly page: number; readonly text: string }[];
}

const fingerprint = (source: Source): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        source.title,
        source.typeSlug,
        source.private,
        source.language,
        source.pages.map(({ page, text }) => [page, text]),
      ]),
    )
    .digest('hex');

const readSource = async (reader: Reader, documentId: string): Promise<Source> => {
  const [document] = await reader
    .select({
      title: documents.title,
      private: documents.private,
      core: documents.core,
      typeSlug: docTypes.slug,
    })
    .from(documents)
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(eq(documents.id, documentId));
  if (document === undefined) throw new DocumentNotFoundError(documentId);
  const pages = await reader
    .select({ page: documentPages.page, text: documentPages.text })
    .from(documentPages)
    .where(eq(documentPages.documentId, documentId))
    .orderBy(asc(documentPages.page));
  return {
    title: document.title,
    typeSlug: document.typeSlug,
    private: document.private,
    language: languageCodeSchema.safeParse(document.core.language).data ?? null,
    pages,
  };
};

const embedInBatches = async (
  embedder: Embedder,
  inputs: readonly string[],
): Promise<readonly Embedding[]> => {
  const embeddings: Embedding[] = [];
  for (const batch of batchesOf(inputs, EMBEDDING_BATCH_SIZE)) {
    embeddings.push(...(await embedder.embed(batch, 'passage')));
  }
  if (embeddings.length !== inputs.length) {
    throw new Error(
      `Embedder ${embedder.model} returned ${String(embeddings.length)} embeddings ` +
        `for ${String(inputs.length)} chunks`,
    );
  }
  return embeddings;
};

interface Prepared {
  readonly source: Source;
  readonly chunks: readonly Chunk[];
  readonly embeddings: readonly Embedding[] | undefined;
}

const prepare = async (embedder: Embedder, source: Source): Promise<Prepared> => {
  // Spec, Privacy: the content of a private document never reaches an external provider,
  // not even to have its tokens counted.
  if (source.private && !embedder.isLocal) {
    return { source, chunks: await chunkPages(source.pages), embeddings: undefined };
  }
  const nextChunks = await chunkPages(source.pages, await chunkingFor(embedder, source));
  const embeddings = await embedInBatches(
    embedder,
    nextChunks.map((chunk) => embeddingInput(chunk.text, source)),
  );
  return { source, chunks: nextChunks, embeddings };
};

// Stores the chunks unless the document changed since they were computed. The row locks keep
// it still from the check to the commit: the lock on the document also holds back two runs
// for one document and the insertion of a page, the locks on the pages hold back their edits.
const replaceChunks = (
  db: Database,
  documentId: string,
  { source, chunks: nextChunks, embeddings }: Prepared,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    await tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId))
      .for('update');
    await tx
      .select({ page: documentPages.page })
      .from(documentPages)
      .where(eq(documentPages.documentId, documentId))
      .for('update');
    if (fingerprint(await readSource(tx, documentId)) !== fingerprint(source)) return false;
    await tx.delete(chunks).where(eq(chunks.documentId, documentId));
    await tx
      .update(documentPages)
      .set({ language: source.language })
      .where(eq(documentPages.documentId, documentId));
    const rows = nextChunks.map((chunk, index) => ({
      documentId,
      language: source.language,
      ...chunk,
      embedding: embeddings?.[index] ?? null,
    }));
    for (const batch of batchesOf(rows, INSERT_BATCH_SIZE)) {
      await tx.insert(chunks).values([...batch]);
    }
    return true;
  });

// The embeddings are computed outside any transaction, so a model failure leaves the previous
// chunks in place; the replacement itself is all or nothing. A document that changes while its
// chunks are computed is read and chunked again.
//
// A document flagged private while a remote embedder was working on it is stored without
// embeddings, but its text had already been sent: the flag protects from the moment it is set.
export const indexDocument = async (
  { db, embedder }: IndexingDeps,
  documentId: string,
): Promise<IndexingResult> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prepared = await prepare(embedder, await readSource(db, documentId));
    if (await replaceChunks(db, documentId, prepared)) {
      return { chunkCount: prepared.chunks.length, embedded: prepared.embeddings !== undefined };
    }
  }
  throw new IndexingConflictError(documentId);
};
