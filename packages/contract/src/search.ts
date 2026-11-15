import { z } from 'zod';
import { searchFiltersSchema, searchInputSchema } from './search/input.ts';

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

const problemSchema = z.looseObject({ code: z.string(), message: z.string() });

// The envelope of a result, for a contract: the rows and groups are described by
// `QueryResult`, and their content depends on the query.
export const queryResultSchema = z.looseObject({
  rows: z.array(z.looseObject({ id: z.string() })).optional(),
  groups: z.array(z.looseObject({})).optional(),
  has_more: z.boolean(),
  warnings: z.array(problemSchema),
});
export type QueryResultEnvelope = z.output<typeof queryResultSchema>;
