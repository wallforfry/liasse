import {
  documentSummarySchema,
  type ListDocumentsOptions,
  PRIVATE_FILTERS,
  type PrivateFilter,
  type SearchRequest,
} from '@liasse/contract';
import { MAX_SEARCH_LIMIT } from '@liasse/contract/search';

export const PAGE_SIZE = 50;

export const DOCUMENT_STATUSES = documentSummarySchema.shape.status.options;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type ListParam = 'q' | 'status' | 'type' | 'private';

/** The filters of a list, as the address of the page carries them. */
export interface ListFilters {
  /** Present, the list is the search for it, ranked by relevance. */
  readonly query?: string;
  readonly status?: DocumentStatus;
  readonly type?: string;
  readonly private: PrivateFilter;
  readonly offset: number;
}

const isStatus = (value: string | null): value is DocumentStatus =>
  DOCUMENT_STATUSES.some((status) => status === value);

const isPrivateFilter = (value: string | null): value is PrivateFilter =>
  PRIVATE_FILTERS.some((filter) => filter === value);

const offsetOf = (value: string | null): number => {
  const offset = Number(value ?? '0');
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

const queryOf = (value: string | null): string | undefined => {
  const query = value?.trim() ?? '';
  return query === '' ? undefined : query;
};

// A search can include private documents or leave them out, not keep only them.
const privacyOf = (value: string | null, query: string | undefined): PrivateFilter => {
  const privacy = isPrivateFilter(value) ? value : 'exclude';
  return query !== undefined && privacy === 'only' ? 'include' : privacy;
};

/** Reads the filters of the address; anything it cannot read is left at its default. */
export const readFilters = (params: URLSearchParams): ListFilters => {
  const query = queryOf(params.get('q'));
  const status = params.get('status');
  const type = params.get('type');
  return {
    ...(query === undefined ? {} : { query }),
    ...(isStatus(status) ? { status } : {}),
    ...(type === null || type === '' ? {} : { type }),
    private: privacyOf(params.get('private'), query),
    offset: offsetOf(params.get('offset')),
  };
};

/** The address with one filter changed, back on the first page. */
export const withFilter = (
  params: URLSearchParams,
  name: ListParam,
  value: string | undefined,
): URLSearchParams => {
  const next = new URLSearchParams(params);
  if (value === undefined) next.delete(name);
  else next.set(name, value);
  next.delete('offset');
  return next;
};

export const withOffset = (params: URLSearchParams, offset: number): URLSearchParams => {
  const next = new URLSearchParams(params);
  if (offset === 0) next.delete('offset');
  else next.set('offset', String(offset));
  return next;
};

export const listOptions = ({
  status,
  type,
  private: privacy,
  offset,
}: ListFilters): ListDocumentsOptions => ({
  ...(status === undefined ? {} : { status }),
  ...(type === undefined ? {} : { type }),
  private: privacy,
  offset,
  limit: PAGE_SIZE,
});

/** The search of a query with the same filters; it ranks, so it has no pages. */
export const searchRequest = (
  query: string,
  { status, type, private: privacy }: ListFilters,
): SearchRequest => ({
  query,
  filters: {
    ...(status === undefined ? {} : { status }),
    ...(type === undefined ? {} : { type }),
  },
  limit: MAX_SEARCH_LIMIT,
  include_private: privacy !== 'exclude',
});
