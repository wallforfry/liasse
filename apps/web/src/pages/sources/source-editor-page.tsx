import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { SourceEditor } from './source-editor.tsx';
import { sourceQueryKey } from './sources-query.ts';

export const NewSourcePage = () => (
  <>
    <PageHeader
      title="New source"
      description="An enabled source runs as soon as it is saved, then at its interval."
    />
    <SourceEditor />
  </>
);

export const EditSourcePage = () => {
  const { id = '' } = useParams();
  const client = useClient();
  const source = useQuery({
    queryKey: sourceQueryKey(id),
    queryFn: async () => client.getSource(id),
    // A refetch would replace what is being typed: the form reads the source once.
    staleTime: Number.POSITIVE_INFINITY,
  });

  const body = (() => {
    if (source.isPending) return <Skeleton className="h-96 w-full max-w-2xl" />;
    if (source.isError) return <ErrorAlert error={source.error} title="Source not loaded" />;
    return <SourceEditor key={source.data.updated_at} source={source.data} />;
  })();

  return (
    <>
      <PageHeader
        title={source.data?.name ?? 'Source'}
        description="A save resumes a source that needs attention, and runs an enabled one now."
      />
      {body}
    </>
  );
};
