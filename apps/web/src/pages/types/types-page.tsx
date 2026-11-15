import type { TypeView } from '@liasse/sdk';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.tsx';
import { CreateType } from './create-type.tsx';
import { TypeStatusBadge } from './type-status-badge.tsx';
import { typePath, useTypes } from './types-query.ts';

const features = tableFeatures({});
const column = createColumnHelper<typeof features, TypeView>();

// Descriptions of types the pipeline created were written by the model after reading a
// document: they are rendered as text only.
const columns = column.columns([
  column.accessor('slug', {
    header: 'Type',
    cell: ({ getValue }) => (
      <Link
        to={typePath(getValue())}
        className="font-mono font-medium underline-offset-4 hover:underline"
      >
        {getValue()}
      </Link>
    ),
  }),
  column.accessor('description', {
    header: 'Description',
    cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
  }),
  column.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => <TypeStatusBadge status={getValue()} />,
  }),
  column.accessor('fields', {
    header: 'Fields',
    cell: ({ getValue }) => Object.keys(getValue()).length,
  }),
  column.accessor('document_count', { header: 'Documents' }),
]);

const TypeTable = ({ types }: { readonly types: readonly TypeView[] }) => {
  const table = useTable({ features, columns, data: types });
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
                <TableCell key={cell.id} className="whitespace-normal">
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

export const TypesPage = () => {
  const [includePrivate, setIncludePrivate] = useState(false);
  const types = useTypes(includePrivate);
  return (
    <>
      <PageHeader
        title="Types"
        description="The document types of the registry. The pipeline creates them as documents arrive; consolidation merges and stabilizes them."
        actions={<CreateType roots={types.data?.types ?? []} />}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="types-private"
          checked={includePrivate}
          onCheckedChange={(checked) => {
            setIncludePrivate(checked === true);
          }}
        />
        <Label htmlFor="types-private">Count private documents</Label>
      </div>
      {types.isPending ? <Skeleton className="h-48 w-full" /> : null}
      {types.isError ? (
        <ErrorAlert error={types.error} title="The types could not be listed" />
      ) : null}
      {types.data === undefined ? null : types.data.types.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No type yet: the first documents will create them.
        </p>
      ) : (
        <TypeTable types={types.data.types} />
      )}
    </>
  );
};
