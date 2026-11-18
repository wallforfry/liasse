import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx';
import { GdriveSourceEditor } from './gdrive-editor.tsx';
import { ImapSourceEditor } from './imap-editor.tsx';
import { sourceQueryKey } from './sources-query.ts';

export const NewSourcePage = () => (
  <>
    <PageHeader
      title="New source"
      description="An enabled mailbox runs once saved, a Drive folder once connected with Google; then at its interval."
    />
    {/* Radix unmounts the inactive tab: a switch of kind drops what the other form held. */}
    <Tabs defaultValue="imap" className="max-w-2xl">
      <TabsList aria-label="Kind of source">
        <TabsTrigger value="imap">IMAP mailbox</TabsTrigger>
        <TabsTrigger value="gdrive">Google Drive folder</TabsTrigger>
      </TabsList>
      <TabsContent value="imap" className="pt-2">
        <ImapSourceEditor />
      </TabsContent>
      <TabsContent value="gdrive" className="pt-2">
        <GdriveSourceEditor />
      </TabsContent>
    </Tabs>
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
    return source.data.kind === 'imap' ? (
      <ImapSourceEditor key={source.data.updated_at} source={source.data} />
    ) : (
      <GdriveSourceEditor key={source.data.updated_at} source={source.data} />
    );
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
