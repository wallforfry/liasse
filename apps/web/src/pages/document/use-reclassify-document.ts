import type { DocumentReclassification } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useClient } from '../../api/session.ts';

/**
 * Asks for the type of one document to be decided again, then reads it again: the server
 * says the analysis is pending, which the page follows until the job is done.
 */
export const useReclassifyDocument = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: DocumentReclassification) => client.reclassifyDocument(id, request),
    onSuccess: async () => {
      toast.success('The type is being analysed again.');
      await queryClient.invalidateQueries({ queryKey: ['document', id] });
    },
  });
};
