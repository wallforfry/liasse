import type { ConsolidationRunView } from '@liasse/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useClient } from '../../api/session.ts';
import {
  CONSOLIDATION_RUNS_QUERY_KEY,
  finishedSince,
  listedIds,
  pollRuns,
  type SeenRuns,
  unfinishedIds,
} from './consolidation-runs.ts';

const announce = ({ status, last_error: lastError }: ConsolidationRunView): void => {
  if (status === 'succeeded') {
    toast.success('The consolidation run finished: its proposals are listed.');
  } else {
    toast.error(`The consolidation run failed: ${lastError ?? 'no error was recorded'}`);
  }
};

const NOTHING_SEEN: SeenRuns = { unfinished: new Set(), listedBeforeRequest: null };

/**
 * The latest consolidation runs, read again while one has not finished. A run this page
 * saw unfinished, or asked for, is announced when it ends, and the changes are read
 * again. `followRequest` is called once a run was asked for, before the runs are read.
 */
export const useConsolidationRuns = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const runs = useQuery({
    queryKey: CONSOLIDATION_RUNS_QUERY_KEY,
    queryFn: async () => client.listConsolidationRuns(),
    refetchInterval: (query) => pollRuns(query.state.data?.runs),
  });
  const seen = useRef<SeenRuns>(NOTHING_SEEN);
  const listed = runs.data?.runs;
  useEffect(() => {
    if (listed === undefined) return;
    const finished = finishedSince(seen.current, listed);
    seen.current = { unfinished: unfinishedIds(listed), listedBeforeRequest: null };
    if (finished.length === 0) return;
    finished.forEach(announce);
    void queryClient.invalidateQueries({ queryKey: ['changes'] });
  }, [listed, queryClient]);
  const followRequest = useCallback(async () => {
    if (listed !== undefined) {
      seen.current = { ...seen.current, listedBeforeRequest: listedIds(listed) };
    }
    await queryClient.invalidateQueries({ queryKey: CONSOLIDATION_RUNS_QUERY_KEY });
  }, [listed, queryClient]);
  return { runs, followRequest };
};
