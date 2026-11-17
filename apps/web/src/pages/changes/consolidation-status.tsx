import type { ConsolidationRunView } from '@liasse/sdk';
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from 'lucide-react';
import { formatTime } from '../../lib/format.ts';

const unfinishedLabel = ({ status, last_error: lastError }: ConsolidationRunView): string => {
  if (status === 'running') return 'Consolidation is running.';
  if (lastError !== null) return `An attempt failed, the run will try again: ${lastError}`;
  return 'A consolidation run is queued.';
};

/** Where the latest consolidation run stands, newest first in `runs`. */
export const ConsolidationStatus = ({
  runs,
}: {
  readonly runs: readonly ConsolidationRunView[];
}) => {
  const [latest] = runs;
  if (latest === undefined) return null;
  const since = `${latest.trigger} run of ${formatTime(latest.queued_at)}`;
  if (latest.status === 'queued' || latest.status === 'running') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
        {unfinishedLabel(latest)}
      </p>
    );
  }
  if (latest.status === 'failed') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-destructive">
        <CircleAlertIcon className="size-4 shrink-0" />
        {`The latest consolidation run failed (${since}): ${latest.last_error ?? 'no error was recorded'}`}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <CircleCheckIcon className="size-4 shrink-0" />
      {`The latest consolidation run finished (${since}).`}
    </p>
  );
};
