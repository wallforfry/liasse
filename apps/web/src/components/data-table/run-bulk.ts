export interface BulkOutcome {
  readonly succeeded: number;
  readonly failures: readonly unknown[];
}

/**
 * Runs `action` on every row at once and counts the outcomes: one row refused does not stop
 * the others, and none is retried.
 */
export const runBulk = async <TData>(
  rows: readonly TData[],
  action: (row: TData) => Promise<unknown>,
): Promise<BulkOutcome> => {
  const settled = await Promise.allSettled(rows.map(async (row) => action(row)));
  return {
    succeeded: settled.filter(({ status }) => status === 'fulfilled').length,
    failures: settled.flatMap((result): unknown[] =>
      result.status === 'rejected' ? [result.reason] : [],
    ),
  };
};
