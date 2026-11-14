import type { Database } from '../db/client.ts';
import { isVersionAtLeast } from '../db/extension-version.ts';
import { ensureBm25Index, rankByBm25 } from './bm25.ts';
import {
  installedPgSearchVersion,
  MIN_PG_SEARCH_VERSION,
  type PgSearchVersionReader,
} from './pg-search.ts';
import { type ChunkRanker, rankByFullText } from './rankers.ts';

export interface FullTextRanking {
  readonly ranker: ChunkRanker;
  /** One line for the operator, when the choice is worth saying. */
  readonly notice: string | undefined;
}

/**
 * Chooses how hybrid search ranks its full-text side, once, at startup: BM25 when ParadeDB
 * pg_search is created in the database (its index is created first), `ts_rank_cd` otherwise.
 * Only tests pass `readVersion`.
 */
export const prepareFullTextRanking = async (
  db: Database,
  readVersion: PgSearchVersionReader = installedPgSearchVersion,
): Promise<FullTextRanking> => {
  const version = await readVersion(db);
  if (version === undefined) return { ranker: rankByFullText, notice: undefined };
  if (!isVersionAtLeast(version, MIN_PG_SEARCH_VERSION)) {
    return {
      ranker: rankByFullText,
      notice:
        `Notice: pg_search ${version} is installed, but BM25 ranking needs ` +
        `${MIN_PG_SEARCH_VERSION.join('.')} or later. Full text is ranked by ts_rank_cd.`,
    };
  }
  await ensureBm25Index(db);
  return { ranker: rankByBm25, notice: `Full text is ranked by BM25 (pg_search ${version}).` };
};
