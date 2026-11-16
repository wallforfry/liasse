import { type DocumentCorrection, LiasseApiError } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';

interface RefusedValue {
  readonly code: string | undefined;
  readonly message: string;
}

// `invalid_correction` lists what the registry refused, one entry per value.
const refusedValues = (error: unknown): readonly RefusedValue[] => {
  if (!(error instanceof LiasseApiError)) return [];
  const { errors } = error.details;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((item: unknown) =>
    typeof item === 'object' &&
    item !== null &&
    'message' in item &&
    typeof item.message === 'string'
      ? [
          {
            code: 'code' in item && typeof item.code === 'string' ? item.code : undefined,
            message: item.message,
          },
        ]
      : [],
  );
};

/**
 * Sends a correction of one document and reads it again once saved. The page gives each
 * form a new key once the document is read again, which resets it.
 *
 * A confirmation refused because the value changed since it was read also reads the
 * document again, so the person reviews the value now stored. The form it came from is
 * reset by that read, so the refusal is told in a toast rather than in the form.
 */
export const useCorrectDocument = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [problems, setProblems] = useState<readonly string[]>([]);
  const readAgain = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['document', id] }),
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
    ]);
  const correct = useMutation({
    mutationFn: async (correction: DocumentCorrection) => client.correctDocument(id, correction),
    onSuccess: async () => {
      toast.success('The correction was saved. The document is processed again.');
      setProblems([]);
      await readAgain();
    },
    onError: async (error) => {
      const refused = refusedValues(error);
      setProblems([errorMessage(error), ...refused.map(({ message }) => message)]);
      if (refused.some(({ code }) => code === 'value_changed')) {
        toast.error(
          'The document changed since it was read. Its values were read again: review them again.',
        );
        await readAgain();
      }
    },
  });
  return { correct, problems, setProblems };
};
