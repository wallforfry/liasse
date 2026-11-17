import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { plural } from '../../lib/format.ts';
import { pollWhileProcessing } from '../../lib/processing.ts';
import { DocumentTable } from './document-table.tsx';
import { type ListFilters, listOptions, PAGE_SIZE } from './list-params.ts';

export interface DocumentListResultsProps {
  readonly filters: ListFilters;
  readonly onOffset: (offset: number) => void;
}

export const DocumentListResults = ({ filters, onOffset }: DocumentListResultsProps) => {
  const client = useClient();
  const options = listOptions(filters);
  const list = useQuery({
    queryKey: ['documents', options],
    queryFn: async () => client.listDocuments(options),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => pollWhileProcessing(query.state.data?.documents),
  });

  if (list.isError) {
    return <ErrorAlert error={list.error} title="The documents could not be listed" />;
  }
  if (list.data === undefined) return <Skeleton className="h-64 w-full" />;
  return (
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
            onOffset(Math.max(0, filters.offset - PAGE_SIZE));
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
            onOffset(filters.offset + PAGE_SIZE);
          }}
        >
          Next
          <ChevronRightIcon />
        </Button>
      </div>
    </>
  );
};
