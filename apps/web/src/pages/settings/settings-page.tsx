import type { SettingsDraft } from '@liasse/contract';
import type { SettingsState } from '@liasse/sdk';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlertIcon } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { formatTime } from '../../lib/format.ts';
import { EmbedderSection } from './embedder-section.tsx';
import { HindsightSection } from './hindsight-section.tsx';
import { LanguageModelsSection } from './language-models-section.tsx';
import { PipelineSection } from './pipeline-section.tsx';
import { isStaleVersion } from './settings-errors.ts';
import { SETTINGS_QUERY_KEY } from './settings-query.ts';
import { type SettingsSection, type SettingsValues, valuesOf } from './settings-form.ts';
import {
  type Issues,
  NO_ISSUES,
  validate,
  validateSection,
  withSectionIssues,
} from './settings-validation.ts';
import { useSaveSettings } from './use-save-settings.ts';

const useSettingsCheck = () => {
  const client = useClient();
  return useMutation({
    mutationFn: async (settings: SettingsDraft) => client.checkSettings({ settings }),
  });
};

const StaleVersion = ({ onReload }: { readonly onReload: () => void }) => (
  <Alert variant="destructive">
    <CircleAlertIcon />
    <AlertTitle>Settings changed elsewhere</AlertTitle>
    <AlertDescription>
      <p>
        They were saved since this page read them. Reload them to see what they are now: the changes
        made here are dropped.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        Reload the settings
      </Button>
    </AlertDescription>
  </Alert>
);

interface SettingsFormProps {
  readonly state: SettingsState;
  readonly onReload: () => void;
}

/** The form of one version of the settings: a new version gives a new form. */
const SettingsForm = ({ state, onReload }: SettingsFormProps) => {
  const [values, setValues] = useState<SettingsValues>(() => valuesOf(state.settings));
  const [issues, setIssues] = useState<Issues>(NO_ISSUES);
  const save = useSaveSettings({
    state,
    onIssues: setIssues,
    onEmbedderLocked: (stored) => {
      // A locked provider and model cannot be edited back: they return to the stored ones.
      const { provider, model } = valuesOf(stored).embedding;
      setValues((previous) => ({
        ...previous,
        embedding: { ...previous.embedding, provider, model },
      }));
    },
  });
  const checks = {
    llm: useSettingsCheck(),
    embedding: useSettingsCheck(),
    hindsight: useSettingsCheck(),
  };

  const section =
    <Section extends SettingsSection>(name: Section) =>
    (next: SettingsValues[Section]): void => {
      setValues((previous) => ({ ...previous, [name]: next }));
    };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validate(values);
    setIssues(validation.valid ? NO_ISSUES : validation.issues);
    if (validation.valid) save.mutate(validation.draft);
  };
  // A check speaks for its own section only: the marks of the others stay as they were.
  const checkOf = (name: keyof typeof checks) => (): void => {
    const validation = validateSection(values, valuesOf(state.settings), name);
    setIssues((previous) => withSectionIssues(previous, name, validation));
    if (validation.valid) checks[name].mutate(validation.draft);
  };

  return (
    <form className="flex max-w-2xl flex-col gap-6" onSubmit={submit} noValidate>
      <LanguageModelsSection
        values={values.llm}
        issues={issues}
        onChange={section('llm')}
        check={checks.llm}
        onCheck={checkOf('llm')}
      />
      <EmbedderSection
        values={values.embedding}
        issues={issues}
        onChange={section('embedding')}
        locked={state.embedder_locked && state.settings !== null}
        check={checks.embedding}
        onCheck={checkOf('embedding')}
      />
      <PipelineSection values={values.pipeline} issues={issues} onChange={section('pipeline')} />
      <HindsightSection
        values={values.hindsight}
        issues={issues}
        onChange={section('hindsight')}
        check={checks.hindsight}
        onCheck={checkOf('hindsight')}
      />
      <p role="status" className="text-sm text-destructive">
        {issues.size === 0 ? null : 'Some settings are not valid: see the marked fields.'}
      </p>
      {isStaleVersion(save.error) ? <StaleVersion onReload={onReload} /> : null}
      {save.error === null || isStaleVersion(save.error) ? null : (
        <ErrorAlert error={save.error} title="Settings not saved" />
      )}
      <Button type="submit" className="self-start" disabled={save.isPending}>
        {save.isPending ? 'Saving...' : 'Save the settings'}
      </Button>
    </form>
  );
};

const savedAt = (state: SettingsState | undefined): string | undefined => {
  if (state === undefined) return undefined;
  return state.updated_at === null ? 'Never saved.' : `Saved ${formatTime(state.updated_at)}.`;
};

/** The settings of the server: models, embedder, pipeline and Hindsight, saved as one. */
export const SettingsPage = () => {
  const client = useClient();
  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async () => client.getSettings(),
    // A refetch of another version replaces the form: only a reload asked for does it.
    staleTime: Number.POSITIVE_INFINITY,
  });
  const reload = () => {
    void settings.refetch();
  };

  const body = (() => {
    if (settings.isPending) return <Skeleton className="h-96 w-full max-w-2xl" />;
    if (settings.isError) return <ErrorAlert error={settings.error} title="Settings not loaded" />;
    return <SettingsForm key={settings.data.version} state={settings.data} onReload={reload} />;
  })();

  return (
    <>
      <PageHeader
        title="Settings"
        description={savedAt(settings.data) ?? 'Applied to the whole server once saved.'}
      />
      {body}
    </>
  );
};
