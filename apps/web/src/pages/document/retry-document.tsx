import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
import { Button } from '../../components/ui/button.tsx';

export const RetryDocument = ({ id }: { readonly id: string }) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: async () => client.retryDocument(id),
    onSuccess: async () => {
      toast.success('The document was queued for processing again.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['document', id] }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
      ]);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  return (
    <Button
      variant="outline"
      disabled={retry.isPending}
      onClick={() => {
        retry.mutate();
      }}
    >
      <RotateCwIcon />
      Retry
    </Button>
  );
};
