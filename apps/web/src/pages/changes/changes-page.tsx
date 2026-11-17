import { LiasseApiError } from '@liasse/sdk';
import { useQuery } from '@tanstack/react-query';
import { InfoIcon } from 'lucide-react';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { ChangeCard } from './change-card.tsx';
import { ConsolidationStatus } from './consolidation-status.tsx';
import { RunConsolidation } from './run-consolidation.tsx';
import { useConsolidationRuns } from './use-consolidation-runs.ts';

// What the API answers while consolidation is not part of the build.
const isNotImplemented = (error: unknown): error is LiasseApiError =>
  error instanceof LiasseApiError && error.status === 501;

export const ChangesPage = () => {
  const client = useClient();
  const changes = useQuery({
    queryKey: ['changes'],
    queryFn: async () => client.listChanges(),
  });
  const { runs, followRequest } = useConsolidationRuns();
  return (
    <>
      <PageHeader
        title="Changes"
        description="What consolidation proposes for the type registry, waiting for a decision."
        actions={<RunConsolidation onRequested={followRequest} />}
      />
      {runs.data === undefined ? null : <ConsolidationStatus runs={runs.data.runs} />}
      {runs.isError && !isNotImplemented(runs.error) ? (
        <ErrorAlert error={runs.error} title="The consolidation runs could not be read" />
      ) : null}
      {changes.isPending ? <Skeleton className="h-48 w-full" /> : null}
      {changes.isError ? (
        isNotImplemented(changes.error) ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Not available</AlertTitle>
            <AlertDescription>{changes.error.message}</AlertDescription>
          </Alert>
        ) : (
          <ErrorAlert error={changes.error} title="The changes could not be listed" />
        )
      ) : null}
      {changes.data === undefined ? null : changes.data.changes.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No change waits for approval.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {changes.data.changes.map((change) => (
            <ChangeCard key={change.id} change={change} />
          ))}
        </div>
      )}
      {changes.data?.truncated === true ? (
        <p className="text-sm text-muted-foreground">
          More changes wait: decide these to see them.
        </p>
      ) : null}
    </>
  );
};
