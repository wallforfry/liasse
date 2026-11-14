import { basename } from 'node:path';
import { type Database, documentLinks, documents } from '@liasse/core/db';
import { createLiasseClient } from '@liasse/sdk';
import { and, eq } from 'drizzle-orm';
import { readDocumentFile } from '../corpus.ts';
import type { Corpus, GroundTruth } from '../schema/index.ts';
import type { Instance } from './instance.ts';
import { waitForPipeline } from './settle.ts';

/** Where each document of the corpus went in the instance, both ways. */
export interface CorpusIds {
  /** The Liasse id of a corpus document; undefined when the instance holds none. */
  readonly liasseOf: (corpusId: string) => string | undefined;
  /** The corpus document a Liasse id stands for: the original, for a deduplicated file. */
  readonly corpusOf: (liasseId: string) => string | undefined;
  /** The corpus document a file was recognised as a copy of, when ingestion said so. */
  readonly duplicateOf: (corpusId: string) => string | null;
}

interface Placed {
  readonly corpusId: string;
  readonly liasseId: string | undefined;
  readonly duplicate: boolean;
}

type Source = GroundTruth['source'];
type FileTruth = GroundTruth & { readonly source: Extract<Source, { kind: 'file' }> };
type AttachmentTruth = GroundTruth & { readonly source: Extract<Source, { kind: 'attachment' }> };

const isFile = (truth: GroundTruth): truth is FileTruth => truth.source.kind === 'file';
const isAttachment = (truth: GroundTruth): truth is AttachmentTruth =>
  truth.source.kind === 'attachment';

// In corpus order, one at a time: a copy comes after its original, so ingestion answers
// it with the document of the original.
const upload = async (instance: Instance, corpus: Corpus): Promise<readonly Placed[]> => {
  const client = createLiasseClient({ baseUrl: instance.baseUrl, token: instance.token });
  const placed: Placed[] = [];
  for (const truth of corpus.documents.filter(isFile)) {
    const bytes = await readDocumentFile(truth);
    if (bytes === undefined) throw new Error(`The corpus has no file for ${truth.id}`);
    const { id, duplicate } = await client.uploadDocument({
      file: new Blob([bytes]),
      filename: basename(truth.source.path),
    });
    placed.push({ corpusId: truth.id, liasseId: id, duplicate });
  }
  return placed;
};

// An attachment is the document ingestion created from the email: linked `attachment_of`
// to it, under the name of the attached file.
const findAttachment = async (
  db: Database,
  truth: AttachmentTruth,
  emailId: string | undefined,
): Promise<Placed> => {
  const [row] =
    emailId === undefined
      ? []
      : await db
          .select({ id: documents.id })
          .from(documentLinks)
          .innerJoin(documents, eq(documents.id, documentLinks.fromDocumentId))
          .where(
            and(
              eq(documentLinks.toDocumentId, emailId),
              eq(documentLinks.kind, 'attachment_of'),
              eq(documents.originalName, truth.source.filename),
            ),
          );
  return { corpusId: truth.id, liasseId: row?.id, duplicate: false };
};

const idsOf = (placed: readonly Placed[]): CorpusIds => {
  const byCorpus = new Map(placed.map((entry) => [entry.corpusId, entry]));
  const originals = new Map(
    placed.flatMap(({ corpusId, liasseId, duplicate }) =>
      liasseId === undefined || duplicate ? [] : [[liasseId, corpusId] as const],
    ),
  );
  return {
    liasseOf: (corpusId) => byCorpus.get(corpusId)?.liasseId,
    corpusOf: (liasseId) => originals.get(liasseId),
    duplicateOf: (corpusId) => {
      const entry = byCorpus.get(corpusId);
      return entry?.duplicate === true && entry.liasseId !== undefined
        ? (originals.get(entry.liasseId) ?? null)
        : null;
    },
  };
};

/**
 * Uploads every file of the corpus through the API, waits for the pipeline to finish
 * with all of them, and finds the documents that only exist as attachments.
 */
export const ingestCorpus = async (instance: Instance, corpus: Corpus): Promise<CorpusIds> => {
  const files = await upload(instance, corpus);
  await waitForPipeline(instance.db);
  const emails = idsOf(files);
  const attachments = await Promise.all(
    corpus.documents
      .filter(isAttachment)
      .map((truth) => findAttachment(instance.db, truth, emails.liasseOf(truth.source.of))),
  );
  return idsOf([...files, ...attachments]);
};
