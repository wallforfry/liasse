import { createColumnHelper, type RowData } from '@tanstack/react-table';
import { Checkbox } from '../ui/checkbox.tsx';
import type { DataTableFeatures } from './data-table-columns.ts';

/** The checkbox column of a selectable data table, its header selecting every row shown. */
export const selectColumn = <TData extends RowData>(rowLabel?: (row: TData) => string) =>
  createColumnHelper<DataTableFeatures, TData>().display({
    id: 'select',
    meta: { className: 'w-8' },
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows"
        checked={
          table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? 'indeterminate'
              : false
        }
        onCheckedChange={(checked) => {
          table.toggleAllPageRowsSelected(checked === true);
        }}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={rowLabel === undefined ? 'Select row' : `Select ${rowLabel(row.original)}`}
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={(checked) => {
          row.toggleSelected(checked === true);
        }}
      />
    ),
  });
