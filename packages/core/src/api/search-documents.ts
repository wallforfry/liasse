import { z } from 'zod';
import { searchFiltersSchema, searchInputSchema } from '../search/input.ts';
import { search } from '../search/search.ts';
import type { ApiContext } from './context.ts';

const { query, limit, includePrivate } = searchInputSchema.shape;
const { dateFrom, dateTo, ...sameNameFilters } = searchFiltersSchema.shape;

// The search input as it travels: the field schemas are those of `search`, under the
// snake_case names of the specification.
export const searchRequestSchema = z.strictObject({
  query,
  filters: z.strictObject({ ...sameNameFilters, date_from: dateFrom, date_to: dateTo }).default({}),
  limit,
  include_private: includePrivate.describe('Private documents are left out unless this is true.'),
});
export type SearchRequest = z.input<typeof searchRequestSchema>;

const snippetSchema = z.object({
  text: z.string(),
  page_from: z.int(),
  page_to: z.int(),
  highlights: z.array(z.object({ start: z.int(), end: z.int() })),
});

export const searchResultsSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      type: z.string().nullable(),
      core: z.record(z.string(), z.unknown()),
      snippets: z.array(snippetSchema),
      score: z.number(),
    }),
  ),
});
export type SearchResults = z.output<typeof searchResultsSchema>;

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
