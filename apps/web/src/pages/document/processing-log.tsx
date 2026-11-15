import type { DocumentEvent, DocumentSummary } from '@liasse/sdk';
import { useQuery } from '@tanstack/react-query';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.tsx';
import { useClient } from '../../api/session.ts';
import { formatTime, plural } from '../../lib/format.ts';
import { pollWhileProcessing } from '../../lib/processing.ts';

type Outcome = DocumentEvent['outcome'];

// Typed by the outcome enumeration of the contract: a new outcome fails the build here.
const OUTCOME_VARIANTS: Readonly<Record<Outcome, 'secondary' | 'outline' | 'destructive'>> = {
  succeeded: 'secondary',
  retrying: 'outline',
  failed: 'destructive',
};

/** The counts and labels of an event, as short phrases. */
const describeDetails = ({
  text_method,
  pages,
  attachments_ingested,
  attachments_skipped,
  classification,
  rejected_values,
  truncated,
}: DocumentEvent['details']): readonly string[] => [
  ...(text_method === undefined ? [] : [`${text_method} text`]),
  ...(pages === undefined ? [] : [plural(pages, 'page')]),
  ...(attachments_ingested === undefined || attachments_ingested === 0
    ? []
    : [plural(attachments_ingested, 'attachment') + ' ingested']),
  ...(attachments_skipped === undefined || attachments_skipped === 0
    ? []
    : [plural(attachments_skipped, 'attachment') + ' skipped']),
  ...(classification === undefined ? [] : [`${classification} type`]),
  ...(rejected_values === undefined ? [] : [plural(rejected_values, 'rejected value')]),
  ...(truncated === true ? ['text truncated'] : []),
];

const attemptOf = ({ attempt, max_attempts }: DocumentEvent): string =>
  attempt === null
    ? ''
    : max_attempts === null
      ? String(attempt)
      : `${String(attempt)} of ${String(max_attempts)}`;

const ProviderDetail = ({ event }: { readonly event: DocumentEvent }) => {
  const parts = [
    ...(event.http_status === null ? [] : [`HTTP ${String(event.http_status)}`]),
    ...(event.provider_code === null ? [] : [event.provider_code]),
  ];
  return parts.length === 0 ? null : (
    <code className="text-xs text-muted-foreground">{parts.join(', ')}</code>
  );
};

const ErrorCell = ({ event }: { readonly event: DocumentEvent }) =>
  event.error_code === null ? null : (
    <span className="flex flex-col gap-0.5">
      <code className="text-xs">{event.error_code}</code>
      {event.error_name === null ? null : (
        <span className="text-xs text-muted-foreground">{event.error_name}</span>
      )}
      <ProviderDetail event={event} />
      {event.retryable === false ? (
        <span className="text-xs text-muted-foreground">not retryable</span>
      ) : null}
    </span>
  );

const EventRow = ({ event }: { readonly event: DocumentEvent }) => (
  <TableRow>
    <TableCell className="whitespace-nowrap">{formatTime(event.occurred_at)}</TableCell>
    <TableCell>{event.stage}</TableCell>
    <TableCell>
      <Badge variant={OUTCOME_VARIANTS[event.outcome]}>{event.outcome}</Badge>
    </TableCell>
    <TableCell>{attemptOf(event)}</TableCell>
    <TableCell>
      <ErrorCell event={event} />
    </TableCell>
    <TableCell className="break-all whitespace-normal">{event.model ?? ''}</TableCell>
    <TableCell className="whitespace-normal">{describeDetails(event.details).join(', ')}</TableCell>
  </TableRow>
);

/**
 * The processing log of a document, oldest first, read again while the document is on
 * its way. A document processed before the log existed has none.
 */
export const ProcessingLog = ({ document }: { readonly document: DocumentSummary }) => {
  const client = useClient();
  const log = useQuery({
    queryKey: ['document-events', document.id],
    queryFn: async () => client.listDocumentEvents(document.id),
    refetchInterval: () => pollWhileProcessing([document]),
  });
  if (log.isPending) return <Skeleton className="h-40 w-full" />;
  if (log.isError) {
    return <ErrorAlert error={log.error} title="The processing log could not be read" />;
  }
  if (log.data.events.length === 0) {
    return <p className="text-sm text-muted-foreground">No processing recorded.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Attempt</TableHead>
          <TableHead>Error</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {log.data.events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </TableBody>
    </Table>
  );
};
