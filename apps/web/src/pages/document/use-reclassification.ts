import {
  type DocumentReclassification,
  type DocumentView,
  type LiasseClient,
  LiasseApiError,
} from '@liasse/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useClient } from '../../api/session.ts';
import { POLL_MILLISECONDS } from '../../lib/processing.ts';
import {
  type CurrentDocument,
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
  } else if (ended.step === 'abandoned') {
    toast.info('The document changed before its type was analysed again: nothing was done.');
  }
};

const currentOf = async (client: LiasseClient, id: string): Promise<CurrentDocument> => {
  try {
    return await client.getDocument(id);
  } catch (error) {
    if (error instanceof LiasseApiError && error.status === 404) return undefined;
    throw error;
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
    // The document is read first: the event of the job commits with the type it writes,
    // so a type seen changed comes with its event in the log read after it.
    queryFn: async () => {
      const current = await currentOf(client, document.id);
      const log =
        current === undefined ? { events: [] } : await client.listDocumentEvents(document.id);
      if (waiting === null) return null;
      const reached = progressOf(waiting, log.events, current);
      if (reached.step !== 'classifying' && reached.step !== 'extracting') await end(reached);
      return reached;
    },
  });

  const underWay: UnderWay =
    waiting === null ? null : progress.data?.step === 'extracting' ? 'extracting' : 'classifying';
  return { request, underWay };
};
