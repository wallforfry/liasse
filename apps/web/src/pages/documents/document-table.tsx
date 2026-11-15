import type { DocumentSummary } from '@liasse/sdk';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { Link } from 'react-router';
import { PrivateBadge, StatusBadge } from '../../components/document-badges.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.tsx';
import { documentPath } from '../../layout/navigation.ts';
import { formatTime } from '../../lib/format.ts';

const features = tableFeatures({});
const column = createColumnHelper<typeof features, DocumentSummary>();

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
        {row.original.title ?? row.original.original_name}
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
}) => {
  const table = useTable({ features, columns, data: documents });
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
