import { ne } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import type { DocumentStatus } from '../domain/enums.ts';

const TOMBSTONE: DocumentStatus = 'deleted';

/**
 * A deleted document leaves a tombstone: a row of `documents` with the status
 * `deleted`, the hash of its file and none of its content. It is what keeps a file
 * still lying in the watched folder from coming back.
 *
 * A tombstone is not a document. Every query that lists, counts, searches or serves
 * documents adds this condition to its `where`.
 */
export const isLiveDocument = ne(documents.status, TOMBSTONE);

/** The same rule for a row already read. */
export const isLiveStatus = (status: DocumentStatus): boolean => status !== TOMBSTONE;
