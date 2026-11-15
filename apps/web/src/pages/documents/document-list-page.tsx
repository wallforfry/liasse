import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { plural } from '../../lib/format.ts';
import { DocumentFilters } from './document-filters.tsx';
import { DocumentTable } from './document-table.tsx';
import {
  type DocumentStatus,
  listOptions,
  PAGE_SIZE,
  readFilters,
  withFilter,
  withOffset,
} from './list-params.ts';

export interface DocumentListPageProps {
  readonly title: string;
  readonly description: string;
  /** Fixed by the page, as the review queue does; the person picks it otherwise. */
  readonly status?: DocumentStatus;
}

export const DocumentListPage = ({ title, description, status }: DocumentListPageProps) => {
  const client = useClient();
  const [params, setParams] = useSearchParams();
  const read = readFilters(params);
  const filters = status === undefined ? read : { ...read, status };
  const options = listOptions(filters);
  const list = useQuery({
    queryKey: ['documents', options],
    queryFn: async () => client.listDocuments(options),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title={title} description={description} />
      <DocumentFilters
        filters={filters}
        statusFilter={status === undefined}
        onChange={(name, value) => {
          setParams(withFilter(params, name, value));
        }}
      />
      {list.isError ? (
        <ErrorAlert error={list.error} title="The documents could not be listed" />
      ) : null}
      {list.data === undefined ? (
        list.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : null
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{plural(list.data.total, 'document')}</p>
          {list.data.documents.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No document matches.
            </p>
          ) : (
            <DocumentTable documents={list.data.documents} />
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.offset === 0}
              onClick={() => {
                setParams(withOffset(params, Math.max(0, filters.offset - PAGE_SIZE)));
              }}
            >
              <ChevronLeftIcon />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!list.data.has_more}
              onClick={() => {
                setParams(withOffset(params, filters.offset + PAGE_SIZE));
              }}
            >
              Next
              <ChevronRightIcon />
            </Button>
          </div>
        </>
      )}
    </>
  );
};
