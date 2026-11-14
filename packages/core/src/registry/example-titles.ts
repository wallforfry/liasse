import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import type { RegistryReader } from './type-store.ts';

// The most recent titles of each type. They end up in prompts and in tool outputs, so a
// private document never lends its title.
export const exampleTitles = async (
  reader: RegistryReader,
  typeIds: readonly string[],
  perType: number,
): Promise<ReadonlyMap<string, readonly string[]>> => {
  if (typeIds.length === 0) return new Map();
  const ranked = reader
    .select({
      typeId: documents.typeId,
      title: documents.title,
      rank: sql<number>`row_number() OVER (PARTITION BY ${documents.typeId} ORDER BY ${documents.ingestedAt} DESC, ${documents.id} DESC)`.as(
        'rank',
      ),
    })
    .from(documents)
    .where(
      and(
        inArray(documents.typeId, [...typeIds]),
        isNotNull(documents.title),
        eq(documents.private, false),
      ),
    )
    .as('ranked');
  const rows = await reader
    .select({ typeId: ranked.typeId, title: ranked.title })
    .from(ranked)
    .where(lte(ranked.rank, perType))
    .orderBy(ranked.typeId, ranked.rank);
  return rows.reduce((titles, { typeId, title }) => {
    if (typeId === null || title === null) return titles;
    return new Map(titles).set(typeId, [...(titles.get(typeId) ?? []), title]);
  }, new Map<string, readonly string[]>());
};
