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

/** An entity filter: its id filters, its name is only shown, as the address carries it. */
export interface EntityFilter {
  readonly id: string;
  readonly name: string;
}

/** The filters of a list, as the address of the page carries them. */
export interface ListFilters {
  /** Present, the list is the search for it, ranked by relevance. */
  readonly query?: string;
  readonly status?: DocumentStatus;
  readonly type?: string;
  readonly entity?: EntityFilter;
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

const ENTITY = 'entity';
const ENTITY_NAME = 'entity_name';

// The name is what the picker showed: an address without one shows the id instead.
const entityOf = (params: URLSearchParams): EntityFilter | undefined => {
  const id = params.get(ENTITY);
  if (id === null || id === '') return undefined;
  const name = params.get(ENTITY_NAME)?.trim() ?? '';
  return { id, name: name === '' ? id : name };
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
  const entity = entityOf(params);
  return {
    ...(query === undefined ? {} : { query }),
    ...(isStatus(status) ? { status } : {}),
    ...(type === null || type === '' ? {} : { type }),
    ...(entity === undefined ? {} : { entity }),
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

/** The address with the entity filter changed or cleared, back on the first page. */
export const withEntity = (
  params: URLSearchParams,
  entity: EntityFilter | undefined,
): URLSearchParams => {
  const next = new URLSearchParams(params);
  if (entity === undefined) {
    next.delete(ENTITY);
    next.delete(ENTITY_NAME);
  } else {
    next.set(ENTITY, entity.id);
    next.set(ENTITY_NAME, entity.name);
  }
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
  entity,
  private: privacy,
  offset,
}: ListFilters): ListDocumentsOptions => ({
  ...(status === undefined ? {} : { status }),
  ...(type === undefined ? {} : { type }),
  ...(entity === undefined ? {} : { entity: entity.id }),
  private: privacy,
  offset,
  limit: PAGE_SIZE,
});

/** The search of a query with the same filters; it ranks, so it has no pages. */
export const searchRequest = (
  query: string,
  { status, type, entity, private: privacy }: ListFilters,
): SearchRequest => ({
  query,
  filters: {
    ...(status === undefined ? {} : { status }),
    ...(type === undefined ? {} : { type }),
    ...(entity === undefined ? {} : { entity: entity.id }),
  },
  limit: MAX_SEARCH_LIMIT,
  include_private: privacy !== 'exclude',
});
