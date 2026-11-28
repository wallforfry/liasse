import type { Source } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
import { SOURCES_QUERY_KEY } from './sources-query.ts';

const useRefreshSources = () => {
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: SOURCES_QUERY_KEY });
  };
};

/** Turns a source on or off; like any save, it clears the flag of refused credentials. */
export const useToggleSource = (source: Source) => {
  const client = useClient();
  const refresh = useRefreshSources();
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      client.updateSource(source.id, { kind: source.kind, enabled }),
    onSuccess: async (saved) => {
      toast.success(saved.enabled ? 'The source is enabled.' : 'The source is disabled.');
      await refresh();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
};

export const useRunSource = (id: string) => {
  const client = useClient();
  const refresh = useRefreshSources();
  return useMutation({
    mutationFn: async () => client.runSource(id),
    onSuccess: async ({ queued }) => {
      toast.success(queued ? 'A run is queued.' : 'A run was already due.');
      await refresh();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
};

/**
 * Checks a source. The variable is the `updated_at` of the source checked: a result only
 * describes that version, not one saved or connected again since.
 */
export const useCheckSource = (id: string) => {
  const client = useClient();
  return useMutation({ mutationFn: async (_checked: string) => client.checkSource(id) });
};

export const useDeleteSource = (id: string) => {
  const client = useClient();
  const refresh = useRefreshSources();
  return useMutation({
    mutationFn: async () => client.deleteSource(id),
    onSuccess: async () => {
      toast.success('The source was deleted.');
      await refresh();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
};
