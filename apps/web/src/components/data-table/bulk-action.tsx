import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { plural } from '../../lib/format.ts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog.tsx';
import { Button } from '../ui/button.tsx';
import { type BulkOutcome, runBulk } from './run-bulk.ts';

export interface BulkActionProps<TData> {
  /** The rows the action applies to; without any, the button is disabled. */
  readonly rows: readonly TData[];
  readonly run: (row: TData) => Promise<unknown>;
  /** Called once every row is done, refused or not: refreshes what the action changed. */
  readonly onSettled: () => Promise<unknown> | undefined;
  readonly label: string;
  readonly icon: ReactNode;
  /** What a row is, as a noun that takes an `s`: `document`. */
  readonly noun: string;
  /** What the action did to a row: `deleted`. */
  readonly done: string;
  /** Asks before running, with these words; a destructive action always has them. */
  readonly confirmation?: { readonly title: string; readonly description: string };
}

const report = (outcome: BulkOutcome, noun: string, done: string) => {
  if (outcome.succeeded > 0) toast.success(`${plural(outcome.succeeded, noun)} ${done}.`);
  const [first] = outcome.failures;
  if (first !== undefined) {
    toast.error(
      `${plural(outcome.failures.length, noun)} could not be ${done}: ${errorMessage(first)}`,
    );
  }
};

/** A button of the bulk action bar, which runs one action on every selected row. */
export const BulkAction = <TData,>({
  rows,
  run,
  onSettled,
  label,
  icon,
  noun,
  done,
  confirmation,
}: BulkActionProps<TData>) => {
  const bulk = useMutation({
    mutationFn: async () => runBulk(rows, run),
    onSuccess: async (outcome) => {
      report(outcome, noun, done);
      await onSettled();
    },
  });
  const trigger = (
    <Button
      variant="outline"
      size="sm"
      disabled={rows.length === 0 || bulk.isPending}
      onClick={
        confirmation === undefined
          ? () => {
              bulk.mutate();
            }
          : undefined
      }
    >
      {icon}
      {label} ({rows.length})
    </Button>
  );
  if (confirmation === undefined) return trigger;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              bulk.mutate();
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
