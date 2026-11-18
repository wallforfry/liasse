import { useQuery } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { NEW_SOURCE_PATH } from '../../layout/navigation.ts';
import { SourceCard } from './source-card.tsx';
import { SOURCES_QUERY_KEY } from './sources-query.ts';

const NoSource = () => (
  <div className="flex max-w-2xl flex-col gap-2 text-sm text-muted-foreground">
    <p>No source yet. Add a mailbox or a Google Drive folder to bring in its documents.</p>
    <p>
      The folder named by WATCH_DIR is not a source here: it stays configured in the environment of
      the server, and is read beside the sources.
    </p>
  </div>
);

/** The ingestion sources: one card each, oldest first. */
export const SourcesPage = () => {
  const client = useClient();
  const sources = useQuery({
    queryKey: SOURCES_QUERY_KEY,
    queryFn: async () => (await client.listSources()).sources,
  });

  const body = (() => {
    if (sources.isPending) return <Skeleton className="h-48 w-full max-w-2xl" />;
    if (sources.isError) return <ErrorAlert error={sources.error} title="Sources not loaded" />;
    if (sources.data.length === 0) return <NoSource />;
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        {sources.data.map((source) => (
          <SourceCard key={source.id} source={source} />
        ))}
      </div>
    );
  })();

  return (
    <>
      <PageHeader
        title="Sources"
        description="Mailboxes and Drive folders Liasse reads on its own, each at its own interval."
        actions={
          <Button asChild>
            <Link to={NEW_SOURCE_PATH}>
              <PlusIcon />
              Add a source
            </Link>
          </Button>
        }
      />
      {body}
    </>
  );
};
