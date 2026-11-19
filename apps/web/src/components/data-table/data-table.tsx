import { type Row, type RowData, useTable } from '@tanstack/react-table';
import type { ComponentType } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.tsx';
import { BulkActionBar } from './bulk-action-bar.tsx';
import {
  type DataTableColumns,
  type DataTableFeatures,
  dataTableFeatures,
} from './data-table-columns.ts';
import { selectColumn } from './select-column.tsx';

export interface BulkActionsProps<TData> {
  /** The selected rows of the data shown, in its order. */
  readonly rows: readonly TData[];
  /** Empties the selection, once an action is done with it. */
  readonly clear: () => void;
}

export interface DataTableProps<TData extends RowData> {
  readonly columns: DataTableColumns<TData>;
  readonly data: readonly TData[];
  readonly getRowId: (row: TData) => string;
  /** How a row is named to assistive technology, on its checkbox. */
  readonly rowLabel?: (row: TData) => string;
  /** The actions on the selected rows. Without them, the table has no checkbox. */
  readonly bulkActions?: ComponentType<BulkActionsProps<TData>>;
}

/**
 * A table of rows (TanStack Table under the shadcn table). Given bulk actions, each row gets
 * a checkbox and the header one that selects every row shown, and a bar holds the actions
 * while a row is selected.
 */
export const DataTable = <TData extends RowData>({
  columns,
  data,
  getRowId,
  rowLabel,
  bulkActions: BulkActions,
}: DataTableProps<TData>) => {
  const selectable = BulkActions !== undefined;
  const table = useTable({
    features: dataTableFeatures,
    columns: selectable ? [selectColumn(rowLabel), ...columns] : [...columns],
    data: [...data],
    getRowId: (row: TData) => getRowId(row),
    enableRowSelection: selectable,
  });
  // The selection keeps the ids of rows that left the data; only rows still shown count.
  const selected = table
    .getSelectedRowModel()
    .rows.map((row: Row<DataTableFeatures, TData>) => row.original);
  const clear = () => {
    table.resetRowSelection(true);
  };
  return (
    <div className="flex flex-col gap-2">
      {selectable && selected.length > 0 ? (
        <BulkActionBar count={selected.length} onClear={clear}>
          <BulkActions rows={selected} clear={clear} />
        </BulkActionBar>
      ) : null}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
