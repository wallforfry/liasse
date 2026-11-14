import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chunks, documentPages, documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { languageCodeSchema } from '../domain/values.ts';
import { batchesOf } from '../models/batching.ts';
import type { Embedder, Embedding } from '../models/ports.ts';
import { type Chunk, chunkPages, embeddingInput } from './chunking.ts';

const EMBEDDING_BATCH_SIZE = 32;

// Postgres accepts 65,535 bind parameters per statement; a chunk row uses six.
const INSERT_BATCH_SIZE = 1000;

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

const readDocument = async (db: Database, documentId: string) => {
  const [document] = await db
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
  return document;
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

interface ChunkReplacement {
  readonly documentId: string;
  readonly language: string | null;
  readonly chunks: readonly Chunk[];
  readonly embeddings: readonly Embedding[] | undefined;
}

const replaceChunks = (
  db: Database,
  { documentId, language, chunks: nextChunks, embeddings }: ChunkReplacement,
): Promise<void> =>
  db.transaction(async (tx) => {
    // Two concurrent runs for one document would otherwise both insert their chunks.
    await tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId))
      .for('update');
    await tx.delete(chunks).where(eq(chunks.documentId, documentId));
    await tx
      .update(documentPages)
      .set({ language })
      .where(eq(documentPages.documentId, documentId));
    const rows = nextChunks.map((chunk, index) => ({
      documentId,
      language,
      ...chunk,
      embedding: embeddings?.[index] ?? null,
    }));
    for (const batch of batchesOf(rows, INSERT_BATCH_SIZE)) {
      await tx.insert(chunks).values([...batch]);
    }
  });

// The embeddings are computed before the transaction opens, so a model failure leaves the
// previous chunks in place, and the replacement itself is all or nothing.
export const indexDocument = async (
  { db, embedder }: IndexingDeps,
  documentId: string,
): Promise<IndexingResult> => {
  const document = await readDocument(db, documentId);
  const pages = await db
    .select({ page: documentPages.page, text: documentPages.text })
    .from(documentPages)
    .where(eq(documentPages.documentId, documentId))
    .orderBy(asc(documentPages.page));
  const nextChunks = chunkPages(pages);
  // Spec, Privacy: the content of a private document never reaches an external provider.
  const embedded = embedder.isLocal || !document.private;
  const embeddings = embedded
    ? await embedInBatches(
        embedder,
        nextChunks.map((chunk) => embeddingInput(chunk.text, document)),
      )
    : undefined;
  await replaceChunks(db, {
    documentId,
    language: languageCodeSchema.safeParse(document.core.language).data ?? null,
    chunks: nextChunks,
    embeddings,
  });
  return { chunkCount: nextChunks.length, embedded };
};
