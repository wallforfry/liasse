import type { DocumentSummary } from '@liasse/sdk';
import { Link } from 'react-router';
import { DataTable } from '../../components/data-table/data-table.tsx';
import { dataTableColumns } from '../../components/data-table/data-table-columns.ts';
import { PrivateBadge, StatusBadge } from '../../components/document-badges.tsx';
import { documentPath } from '../../layout/navigation.ts';
import { formatTime } from '../../lib/format.ts';
import { DocumentBulkActions } from './document-bulk-actions.tsx';

const column = dataTableColumns<DocumentSummary>();

const documentName = (document: DocumentSummary): string =>
  document.title ?? document.original_name;

// Titles, types and file names come from documents: they are rendered as text only.
const columns = column.columns([
  column.display({
    id: 'title',
    header: 'Title',
    cell: ({ row }) => (
      <Link
        to={documentPath(row.original.id)}
        className="font-medium underline-offset-4 hover:underline"
      >
        {documentName(row.original)}
      </Link>
    ),
  }),
  column.accessor('type', {
    header: 'Type',
    cell: ({ getValue }) => getValue() ?? <span className="text-muted-foreground">untyped</span>,
  }),
  column.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => <StatusBadge status={getValue()} />,
  }),
  column.accessor('private', {
    header: 'Privacy',
    cell: ({ getValue }) => (getValue() ? <PrivateBadge /> : null),
  }),
  column.accessor('ingested_at', {
    header: 'Ingested',
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-muted-foreground">{formatTime(getValue())}</span>
    ),
  }),
]);

export const DocumentTable = ({
  documents,
}: {
  readonly documents: readonly DocumentSummary[];
}) => (
  <DataTable
    columns={columns}
    data={documents}
    getRowId={({ id }) => id}
    rowLabel={documentName}
    bulkActions={DocumentBulkActions}
  />
);
