import type { TypeView } from '@liasse/sdk';
import { useState } from 'react';
import { Link } from 'react-router';
import { DataTable } from '../../components/data-table/data-table.tsx';
import { dataTableColumns } from '../../components/data-table/data-table-columns.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { CreateType } from './create-type.tsx';
import { TypeStatusBadge } from './type-status-badge.tsx';
import { typePath, useTypes } from './types-query.ts';

const column = dataTableColumns<TypeView>();

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
    meta: { className: 'whitespace-normal' },
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
        <DataTable columns={columns} data={types.data.types} getRowId={({ slug }) => slug} />
      )}
    </>
  );
};
