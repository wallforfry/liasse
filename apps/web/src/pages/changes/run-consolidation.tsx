import { useMutation } from '@tanstack/react-query';
import { PlayIcon } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
import { Button } from '../../components/ui/button.tsx';

/** Asks for a run; `onRequested` follows it, since a worker runs it after the answer. */
export const RunConsolidation = ({
  onRequested,
}: {
  readonly onRequested: () => Promise<void>;
}) => {
  const client = useClient();
  const run = useMutation({
    mutationFn: async () => client.requestConsolidationRun(),
    onSuccess: async ({ queued }) => {
      if (queued) {
        toast.success('A consolidation run was queued.');
      } else {
        toast.info('A consolidation run is already queued.');
      }
      await onRequested();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  return (
    <Button
      variant="outline"
      disabled={run.isPending}
      onClick={() => {
        run.mutate();
      }}
    >
      <PlayIcon />
      Run consolidation
    </Button>
  );
};
