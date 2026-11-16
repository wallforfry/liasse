import type { DocumentView, LiasseClient } from '@liasse/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useClient } from '../../api/session.ts';
import { isAnalysedAgain } from '../../lib/processing.ts';
import { type AnalysisOutcome, analysisOutcomeOf } from './analysis-outcome.ts';

const announce = (outcome: AnalysisOutcome): void => {
  if (outcome.kind === 'done') {
    toast.success(`The document was analysed again: its type is ${outcome.type ?? 'untyped'}.`);
  } else if (outcome.kind === 'failed') {
    toast.error(
      `The new analysis failed (${outcome.errorCode ?? 'no code'}): the document is as it was.`,
    );
  } else {
    toast.info('The document changed before it could be analysed again: nothing was done.');
  }
};

const eventIds = async (client: LiasseClient, id: string): Promise<ReadonlySet<string>> => {
  const { events } = await client.listDocumentEvents(id);
  return new Set(events.map((event) => event.id));
};

/**
 * Tells the person how a new analysis of a settled document ended, whoever asked for it
 * and whether the page was open when it started: from the events logged since the page
 * first saw it pending. Then reads again what it changed.
 */
export const useAnalysisOutcome = (document: DocumentView) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const { id, type } = document;
  const pending = isAnalysedAgain(document);
  const seen = useRef<Promise<ReadonlySet<string>> | null>(null);
  useEffect(() => {
    if (pending) {
      seen.current ??= eventIds(client, id);
      return;
    }
    const started = seen.current;
    if (started === null) return;
    seen.current = null;
    void (async () => {
      const [before, { events }] = await Promise.all([started, client.listDocumentEvents(id)]);
      announce(analysisOutcomeOf(before, events, type));
      await Promise.all(
        [['document-events', id], ['documents'], ['types']].map(async (queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    })().catch(() => {
      toast.info('The analysis ended; its log could not be read.');
    });
  }, [client, id, type, pending, queryClient]);
};
