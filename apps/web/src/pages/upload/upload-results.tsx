import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  CopyIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { errorMessage } from '../../api/errors.ts';
import { documentPath } from '../../layout/navigation.ts';
import type { UploadEntry, UploadOutcome } from './use-upload-batch.ts';

const OutcomeLine = ({ outcome }: { readonly outcome: UploadOutcome }) => {
  switch (outcome.status) {
    case 'waiting':
      return (
        <span className="text-muted-foreground flex items-center gap-1">
          <ClockIcon className="size-4" /> Waiting
        </span>
      );
    case 'uploading':
      return (
        <span className="text-muted-foreground flex items-center gap-1">
          <LoaderCircleIcon className="size-4 animate-spin" /> Uploading
        </span>
      );
    case 'uploaded':
      return (
        <Link
          to={documentPath(outcome.result.id)}
          className="flex items-center gap-1 underline-offset-4 hover:underline"
        >
          {outcome.result.duplicate ? (
            <>
              <CopyIcon className="size-4" /> Already in Liasse
            </>
          ) : (
            <>
              <CircleCheckIcon className="size-4" /> Uploaded
            </>
          )}
        </Link>
      );
    case 'failed':
      return (
        <span className="text-destructive flex items-center gap-1">
          <CircleAlertIcon className="size-4 shrink-0" /> {errorMessage(outcome.error)}
        </span>
      );
  }
};

export const UploadResults = ({ entries }: { readonly entries: readonly UploadEntry[] }) => (
  <ul aria-label="Uploads" className="divide-y text-sm">
    {entries.map((entry) => (
      <li key={entry.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span className="truncate font-medium">{entry.name}</span>
        <OutcomeLine outcome={entry.outcome} />
      </li>
    ))}
  </ul>
);
