import { type DocumentCorrection, LiasseApiError } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';

// `invalid_correction` lists what the registry refused, one message per value.
const refusedValues = (error: unknown): readonly string[] => {
  if (!(error instanceof LiasseApiError)) return [];
  const { errors } = error.details;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((item: unknown) =>
    typeof item === 'object' &&
    item !== null &&
    'message' in item &&
    typeof item.message === 'string'
      ? [item.message]
      : [],
  );
};

/**
 * Sends a correction of one document and reads it again once saved. The page gives each
 * form a new key once the document is read again, which resets it.
 */
export const useCorrectDocument = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [problems, setProblems] = useState<readonly string[]>([]);
  const correct = useMutation({
    mutationFn: async (correction: DocumentCorrection) => client.correctDocument(id, correction),
    onSuccess: async () => {
      toast.success('The correction was saved. The document is processed again.');
      setProblems([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['document', id] }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
      ]);
    },
    onError: (error) => {
      setProblems([errorMessage(error), ...refusedValues(error)]);
    },
  });
  return { correct, problems, setProblems };
};
