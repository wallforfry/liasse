import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documentOrigins, ingestionSources } from '../db/schema/sources.ts';
import {
  SourceFileChangedError,
  type SourceFiles,
  SourceFileUnavailableError,
} from '../ingest/document-file.ts';
import type { SecretBox } from '../settings/secret-box.ts';
import { bindConnector, readableSecret } from './connect.ts';
import { type SourceConnectors, SourceCredentialsError } from './connector.ts';
import { parseSourceRow } from './store.ts';

export interface SourceFilesDeps {
  readonly db: Database;
  readonly secrets: SecretBox;
  readonly connectors: SourceConnectors;
}

// Every origin of the document still held where its source reads, oldest first: any of
// them holds the same bytes, by the hash of the document.
const originsOf = (db: Database, documentId: string) =>
  db
    .select({
      externalId: documentOrigins.externalId,
      checksum: documentOrigins.checksum,
      source: ingestionSources,
    })
    .from(documentOrigins)
    .innerJoin(ingestionSources, eq(ingestionSources.id, documentOrigins.sourceId))
    .where(and(eq(documentOrigins.documentId, documentId), isNull(documentOrigins.removedAt)))
    .orderBy(asc(documentOrigins.firstSeenAt));

type Attempt =
  { readonly opened: AsyncIterable<Uint8Array> } | { readonly refused: 'changed' | 'unavailable' };

const attempt = async (open: () => Promise<AsyncIterable<Uint8Array>>): Promise<Attempt> => {
  try {
    return { opened: await open() };
  } catch (error) {
    if (error instanceof SourceFileChangedError) return { refused: 'changed' };
    // A source whose credentials no longer work holds the file out of reach, as one that
    // lost it does; another origin may still serve it.
    if (error instanceof SourceFileUnavailableError || error instanceof SourceCredentialsError) {
      return { refused: 'unavailable' };
    }
    throw error;
  }
};

/**
 * The files of documents that stay at their source, opened through the connector of an
 * origin. The first origin that serves the file wins; when none does, the document's file
 * changed at a source or is unavailable at all of them.
 */
export const createSourceFiles = ({ db, secrets, connectors }: SourceFilesDeps): SourceFiles => ({
  open: async (documentId, signal) => {
    let changed = false;
    for (const { externalId, checksum, source: row } of await originsOf(db, documentId)) {
      const source = parseSourceRow(row);
      const { openFile } = bindConnector(connectors, source);
      if (openFile === undefined) continue;
      const result = await attempt(() =>
        openFile(readableSecret(secrets, source), { externalId, checksum }, signal),
      );
      if ('opened' in result) return result.opened;
      changed ||= result.refused === 'changed';
    }
    if (changed) {
      throw new SourceFileChangedError('The source holds another version of the file.');
    }
    throw new SourceFileUnavailableError('No source holds the file of this document any more.');
  },
});
