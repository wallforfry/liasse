import { useMutation } from '@tanstack/react-query';
import { PlayIcon } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
import { Button } from '../../components/ui/button.tsx';

// The run is a job: its proposals reach the list when a worker has run it, not on answer.
export const RunConsolidation = () => {
  const client = useClient();
  const run = useMutation({
    mutationFn: async () => client.requestConsolidationRun(),
    onSuccess: ({ queued }) => {
      if (queued) toast.success('A consolidation run was queued. Its proposals will appear here.');
      else toast.info('A consolidation run is already queued.');
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
