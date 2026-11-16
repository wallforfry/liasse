import type { DocumentReclassification, DocumentView } from '@liasse/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useClient } from '../../api/session.ts';
import { POLL_MILLISECONDS } from '../../lib/processing.ts';
import {
  progressOf,
  type Reclassification,
  type ReclassificationProgress,
  reclassificationOf,
} from './reclassification.ts';

interface Waiting extends Reclassification {
  /** Tells one request from the next in the cache. */
  readonly number: number;
}

/** What a reclassification is waiting for, null when none is. */
export type UnderWay = 'classifying' | 'extracting' | null;

const announce = (ended: ReclassificationProgress): void => {
  if (ended.step === 'done') {
    toast.success(`The type was analysed again: ${ended.type ?? 'untyped'}.`);
  } else if (ended.step === 'failed') {
    toast.error(`The new analysis of the type failed (${ended.errorCode ?? 'no code'}).`);
  }
};

/**
 * Asks for the type of a document to be decided again, then reads its log and the
 * document until the classification, and the re-extraction a new type starts, are logged.
 * The status of the document stays settled meanwhile, so the polling of the page does not
 * see them.
 */
export const useReclassification = (document: DocumentView) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const request = useMutation({
    mutationFn: async (input: DocumentReclassification): Promise<Waiting> => {
      const before = await client.listDocumentEvents(document.id);
      await client.reclassifyDocument(document.id, input);
      return { ...reclassificationOf(before.events, document.type), number: Date.now() };
    },
    onSuccess: (started) => {
      toast.success('The type is being analysed again.');
      setWaiting(started);
    },
  });

  const end = async (ended: ReclassificationProgress): Promise<void> => {
    announce(ended);
    setWaiting(null);
    await Promise.all(
      [['document', document.id], ['document-events', document.id], ['documents'], ['types']].map(
        async (queryKey) => queryClient.invalidateQueries({ queryKey }),
      ),
    );
  };

  const progress = useQuery({
    queryKey: ['reclassification', document.id, waiting?.number],
    enabled: waiting !== null,
    gcTime: 0,
    refetchInterval: POLL_MILLISECONDS,
    queryFn: async () => {
      const [log, view] = await Promise.all([
        client.listDocumentEvents(document.id),
        client.getDocument(document.id),
      ]);
      if (waiting === null) return null;
      const reached = progressOf(waiting, log.events, view.type);
      if (reached.step === 'done' || reached.step === 'failed') await end(reached);
      return reached;
    },
  });

  const underWay: UnderWay =
    waiting === null ? null : progress.data?.step === 'extracting' ? 'extracting' : 'classifying';
  return { request, underWay };
};
