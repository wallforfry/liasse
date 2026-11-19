import {
  type CellData,
  type ColumnDef,
  createColumnHelper,
  type RowData,
  rowSelectionFeature,
  type TableFeatures,
  tableFeatures,
} from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // A merged declaration repeats the type parameters of TanStack's, used or not.
  /* eslint-disable @typescript-eslint/no-unused-vars -- named as TanStack names them */
  interface ColumnMeta<
    in out TFeatures extends TableFeatures,
    in out TData extends RowData,
    TValue extends CellData = CellData,
  > {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    /** Classes of the header and of every cell of the column. */
    readonly className?: string;
  }
}

export const dataTableFeatures = tableFeatures({ rowSelectionFeature });
export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumns<TData extends RowData> = readonly ColumnDef<
  DataTableFeatures,
  TData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the type of TanStack's own list
  any
>[];

/** The column helper of a data table over rows of `TData`. */
export const dataTableColumns = <TData extends RowData>() =>
  createColumnHelper<DataTableFeatures, TData>();
