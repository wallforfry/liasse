import type { SourceCreate, SourcePatch } from '@liasse/contract';
import type { Source } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useClient } from '../../api/session.ts';
import { SOURCES_PATH } from '../../layout/navigation.ts';
import type { Issues } from '../settings/settings-validation.ts';
import { sourceIssuesOf } from './source-errors.ts';
import { SOURCES_QUERY_KEY } from './sources-query.ts';

/** What the form sends: a new source, or every field of a saved one. */
export type SourceSave =
  | { readonly action: 'create'; readonly source: SourceCreate }
  | { readonly action: 'update'; readonly id: string; readonly patch: SourcePatch };

/** Saves the form, then returns to the list; a refusal marks the fields it names. */
export const useSaveSource = (onIssues: (issues: Issues) => void) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (save: SourceSave): Promise<Source> =>
      save.action === 'create'
        ? client.createSource(save.source)
        : client.updateSource(save.id, save.patch),
    onSuccess: async (saved) => {
      toast.success(
        saved.enabled ? 'The source is saved and runs now.' : 'The source is saved, disabled.',
      );
      await queryClient.invalidateQueries({ queryKey: SOURCES_QUERY_KEY });
      await navigate(SOURCES_PATH);
    },
    onError: (error) => {
      onIssues(sourceIssuesOf(error));
    },
  });
};
