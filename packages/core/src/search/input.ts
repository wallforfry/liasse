import { z } from 'zod';
import { liveDocumentStatusSchema } from '../domain/schemas.ts';

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;

export const searchFiltersSchema = z.strictObject({
  type: z.string().min(1).optional(),
  entity: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  status: liveDocumentStatusSchema.optional(),
});

export const searchInputSchema = z.strictObject({
  query: z.string(),
  filters: searchFiltersSchema.default({}),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT),
  includePrivate: z.boolean().default(false),
});

export type SearchFilters = z.output<typeof searchFiltersSchema>;
export type SearchInput = z.input<typeof searchInputSchema>;
