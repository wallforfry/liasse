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

type Refusal = 'changed' | 'unavailable' | 'credentials';

type Attempt =
  | { readonly opened: AsyncIterable<Uint8Array> }
  | { readonly refused: Refusal; readonly error: Error };

const attempt = async (open: () => Promise<AsyncIterable<Uint8Array>>): Promise<Attempt> => {
  try {
    return { opened: await open() };
  } catch (error) {
    if (error instanceof SourceFileChangedError) return { refused: 'changed', error };
    if (error instanceof SourceFileUnavailableError) return { refused: 'unavailable', error };
    // Another origin may still serve the file; if none does, this refusal is told as itself.
    if (error instanceof SourceCredentialsError) return { refused: 'credentials', error };
    throw error;
  }
};

// What a reader is told when no origin served the file. A source that refused its
// credentials says nothing of the file, and is retried once a person connects it again;
// it wins over a file reported gone only when it is the one refusal heard.
const refusalOf = (refusals: readonly Extract<Attempt, { refused: Refusal }>[]): Error => {
  const changed = refusals.find(({ refused }) => refused === 'changed');
  if (changed !== undefined) {
    return new SourceFileChangedError('The source holds another version of the file.');
  }
  const credentials = refusals.find(({ refused }) => refused === 'credentials');
  if (credentials !== undefined && refusals.every(({ refused }) => refused === 'credentials')) {
    return credentials.error;
  }
  return new SourceFileUnavailableError('No source holds the file of this document any more.');
};

/**
 * The files of documents that stay at their source, opened through the connector of an
 * origin. The first origin that serves the file wins; when none does, the file changed at
 * a source, is unavailable at all of them, or every source refused its credentials
 * (`SourceCredentialsError`, transient for whoever reads).
 */
export const createSourceFiles = ({ db, secrets, connectors }: SourceFilesDeps): SourceFiles => ({
  open: async (documentId, signal) => {
    const refusals: Extract<Attempt, { refused: Refusal }>[] = [];
    for (const { externalId, checksum, source: row } of await originsOf(db, documentId)) {
      const source = parseSourceRow(row);
      const { openFile } = bindConnector(connectors, source);
      if (openFile === undefined) continue;
      const result = await attempt(async () =>
        openFile(readableSecret(secrets, source), { externalId, checksum }, signal),
      );
      if ('opened' in result) return result.opened;
      refusals.push(result);
    }
    throw refusalOf(refusals);
  },
});
