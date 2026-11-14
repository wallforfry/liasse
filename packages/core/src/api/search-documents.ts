import { type SearchRequest, searchRequestSchema, type SearchResults } from '../contract/search.ts';
import { search } from '../search/search.ts';
import type { ApiContext } from './context.ts';

/** Hybrid search. Titles, core values and snippets are untrusted document content. */
export const searchDocuments = async (
  { db, embedder, fullText }: Pick<ApiContext, 'db' | 'embedder' | 'fullText'>,
  request: SearchRequest,
): Promise<SearchResults> => {
  const { filters, include_private, ...rest } = searchRequestSchema.parse(request);
  const { date_from, date_to, ...others } = filters;
  const hits = await search(
    { db, embedder, fullText },
    {
      ...rest,
      includePrivate: include_private,
      filters: {
        ...others,
        ...(date_from === undefined ? {} : { dateFrom: date_from }),
        ...(date_to === undefined ? {} : { dateTo: date_to }),
      },
    },
  );
  return {
    results: hits.map(({ snippets, ...hit }) => ({
      ...hit,
      snippets: snippets.map(({ text, pageFrom, pageTo, highlights }) => ({
        text,
        page_from: pageFrom,
        page_to: pageTo,
        highlights: highlights.map(({ start, end }) => ({ start, end })),
      })),
    })),
  };
};
