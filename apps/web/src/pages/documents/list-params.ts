import {
  documentSummarySchema,
  type ListDocumentsOptions,
  PRIVATE_FILTERS,
  type PrivateFilter,
} from '@liasse/core/contract';

export const PAGE_SIZE = 50;

export const DOCUMENT_STATUSES = documentSummarySchema.shape.status.options;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type ListParam = 'status' | 'type' | 'private';

/** The filters of a list, as the address of the page carries them. */
export interface ListFilters {
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

/** Reads the filters of the address; anything it cannot read is left at its default. */
export const readFilters = (params: URLSearchParams): ListFilters => {
  const status = params.get('status');
  const type = params.get('type');
  const privacy = params.get('private');
  return {
    ...(isStatus(status) ? { status } : {}),
    ...(type === null || type === '' ? {} : { type }),
    private: isPrivateFilter(privacy) ? privacy : 'exclude',
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

export const listOptions = (filters: ListFilters): ListDocumentsOptions => ({
  ...filters,
  limit: PAGE_SIZE,
});
