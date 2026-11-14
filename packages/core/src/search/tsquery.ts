import type { Database } from '../db/client.ts';
import { CHUNK_SOURCE } from './rankers.ts';
import { parseQueryFor } from './ranked-source.ts';

// The query as read in every language the chunks are written in. Undefined when the index
// holds no chunk, hence no language to read the query in.
export const parseSearchQuery = (db: Database, query: string): Promise<string | undefined> =>
  parseQueryFor(db, CHUNK_SOURCE, query);
