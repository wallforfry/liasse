import type { DocumentView } from '@liasse/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Tells the person when a pending analysis of the document ends, whoever asked for it and
 * whether or not the page was open when it started, then reads again what it changed.
 */
export const useAnalysisOutcome = ({ id, type, analysis_pending: pending }: DocumentView) => {
  const queryClient = useQueryClient();
  const wasPending = useRef(pending);
  useEffect(() => {
    const ended = wasPending.current && !pending;
    wasPending.current = pending;
    if (!ended) return;
    toast.info(`The document was analysed again: its type is ${type ?? 'untyped'}.`);
    void Promise.all(
      [['document-events', id], ['documents'], ['types']].map(async (queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  }, [id, type, pending, queryClient]);
};
