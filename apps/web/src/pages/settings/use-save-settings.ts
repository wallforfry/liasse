import type { SettingsDraft } from '@liasse/contract';
import type { SettingsState, SettingsView } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useClient } from '../../api/session.ts';
import { isEmbedderLocked, serverIssuesOf } from './settings-errors.ts';
import { SETTINGS_QUERY_KEY } from './settings-query.ts';
import type { Issues } from './settings-validation.ts';

interface SaveSettingsOptions {
  readonly state: SettingsState;
  /** The fields a refused save names; none for any other outcome. */
  readonly onIssues: (issues: Issues) => void;
  /** The embedder locked since the settings were read: the stored settings, read again. */
  readonly onEmbedderLocked: (stored: SettingsView | null) => void;
}

/** Saves a draft at the version `state` was read at. */
export const useSaveSettings = ({ state, onIssues, onEmbedderLocked }: SaveSettingsOptions) => {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: SettingsDraft) =>
      client.saveSettings({ version: state.version, settings }),
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, saved);
      toast.success('The settings are saved and in force.');
    },
    onError: async (error) => {
      onIssues(serverIssuesOf(error));
      if (!isEmbedderLocked(error)) return;
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      const read = queryClient.getQueryData<SettingsState>(SETTINGS_QUERY_KEY);
      onEmbedderLocked(read?.settings ?? state.settings);
    },
  });
};
