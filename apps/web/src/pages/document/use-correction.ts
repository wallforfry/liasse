import { type DocumentCorrection, LiasseApiError } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';

// `invalid_correction` lists what the registry refused, one message per value.
const problemsOf = (error: unknown): readonly string[] => {
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

export interface Correcting {
  readonly send: (correction: DocumentCorrection) => void;
  readonly pending: boolean;
  /** What stopped the last correction, from the server or from reading the form. */
  readonly problems: readonly string[];
  readonly refuse: (problem: string) => void;
}

/**
 * Sends a correction of the document, then reads it again. The page gives a form a new
 * key once the document is read again, which resets it.
 */
export const useCorrection = (documentId: string, saved: string): Correcting => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [problems, setProblems] = useState<readonly string[]>([]);
  const correct = useMutation({
    mutationFn: async (correction: DocumentCorrection) =>
      client.correctDocument(documentId, correction),
    onSuccess: async () => {
      toast.success(saved);
      setProblems([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['document', documentId] }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
      ]);
    },
    onError: (error) => {
      setProblems([errorMessage(error), ...problemsOf(error)]);
    },
  });
  return {
    send: (correction) => {
      correct.mutate(correction);
    },
    pending: correct.isPending,
    problems,
    refuse: (problem) => {
      setProblems([problem]);
    },
  };
};
