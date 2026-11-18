import type { SourceRun } from '@liasse/sdk';
import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { formatTime, plural } from '../../lib/format.ts';

const countsOf = ({ ingested, duplicates, skipped }: SourceRun): string =>
  `${String(ingested)} ingested, ${plural(duplicates, 'duplicate')}, ${String(skipped)} skipped.`;

/** What the last run of a source did. Item names, reasons and messages are untrusted text. */
export const SourceLastRun = ({ run }: { readonly run: SourceRun | null }) => {
  if (run === null) return <p className="text-sm text-muted-foreground">Never run yet.</p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        Last run finished {formatTime(run.finished_at)}: {countsOf(run)}
      </p>
      {run.skipped_items.length === 0 ? null : (
        <ul aria-label="Skipped items" className="flex flex-col gap-1 text-muted-foreground">
          {run.skipped_items.map(({ external_id, name, reason }) => (
            <li key={external_id}>
              <span className="font-medium text-foreground">{name}</span>: {reason}
            </li>
          ))}
        </ul>
      )}
      {run.error === null ? null : (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            {run.error.kind === 'credentials'
              ? 'The run stopped: the password was refused'
              : 'The run stopped early'}
          </AlertTitle>
          <AlertDescription>{run.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
};
