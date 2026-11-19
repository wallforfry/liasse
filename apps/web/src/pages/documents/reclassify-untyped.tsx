import type { FlaggedReclassificationResult } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
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
} from '../../components/ui/alert-dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { plural } from '../../lib/format.ts';

const outcomeMessage = ({
  queued,
  skipped,
  refused,
  remaining,
}: FlaggedReclassificationResult): string =>
  [
    queued === 0
      ? 'No untyped document was queued.'
      : `${plural(queued, 'untyped document')} queued to be analysed again.`,
    ...(skipped === 0
      ? []
      : [`${plural(skipped, 'document')} skipped: already queued or being processed.`]),
    ...(refused === 0
      ? []
      : [
          `${plural(refused, 'document')} left out: their last analysis was refused, open them one by one.`,
        ]),
    ...(remaining === 0 ? [] : [`${plural(remaining, 'document')} left: ask again.`]),
  ].join(' ');

/** Asks for the type of every untyped document of the review queue to be decided again. */
export const ReclassifyUntyped = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const reclassify = useMutation({
    mutationFn: async () => client.reclassifyFlaggedDocuments({ reason: 'type_untyped' }),
    onSuccess: async (result) => {
      toast.success(outcomeMessage(result));
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={reclassify.isPending}>
          <RefreshCwIcon />
          Analyse untyped documents again
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Analyse the untyped documents again?</AlertDialogTitle>
          <AlertDialogDescription>
            The type of every document of the queue left without one is decided again by the model,
            which may create a new type, and its values are read again for that type. Each document
            costs model calls; those already being processed are skipped.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              reclassify.mutate();
            }}
          >
            Analyse again
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
