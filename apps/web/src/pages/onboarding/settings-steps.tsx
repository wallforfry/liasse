import type { SubmitEvent } from 'react';
import type { SettingsCheckMutation } from '../settings/check-results.tsx';
import { EmbedderSection } from '../settings/embedder-section.tsx';
import { LanguageModelsSection } from '../settings/language-models-section.tsx';
import type { SettingsSection, SettingsValues } from '../settings/settings-form.ts';
import type { Issues } from '../settings/settings-validation.ts';
import { sectionIssues, validateSetupSettings } from './setup-validation.ts';
import { StepActions } from './step-actions.tsx';

interface SettingsStepProps {
  readonly values: SettingsValues;
  readonly issues: Issues;
  readonly onChange: (values: SettingsValues) => void;
  readonly onIssues: (issues: Issues) => void;
  readonly check: SettingsCheckMutation;
  readonly onBack: () => void;
  readonly onNext: () => void;
}

/** Marks the fields of `section`, then hands on the whole draft if they are valid. */
const validator =
  (
    section: SettingsSection,
    { values, onIssues }: Pick<SettingsStepProps, 'values' | 'onIssues'>,
  ) =>
  (then: (validation: ReturnType<typeof validateSetupSettings>) => void): void => {
    const validation = validateSetupSettings(values);
    const issues = sectionIssues(validation, section);
    onIssues(issues);
    if (issues.size === 0) then(validation);
  };

const stepHandlers = (section: SettingsSection, props: SettingsStepProps) => {
  const validated = validator(section, props);
  return {
    submit: (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      validated(() => {
        props.onNext();
      });
    },
    runCheck: () => {
      validated((validation) => {
        if (validation.valid) props.check.mutate(validation.draft);
      });
    },
    section:
      <Section extends SettingsSection>(name: Section) =>
      (next: SettingsValues[Section]): void => {
        props.onChange({ ...props.values, [name]: next });
      },
  };
};

/**
 * The text and vision models, with a check of both before the account exists. Their ids are
 * typed by hand: listing the models of a provider takes a session, which no one has yet.
 */
export const LanguageModelsStep = (props: SettingsStepProps) => {
  const { submit, runCheck, section } = stepHandlers('llm', props);
  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <LanguageModelsSection
        values={props.values.llm}
        issues={props.issues}
        onChange={section('llm')}
        check={props.check}
        onCheck={runCheck}
        listModels={false}
      />
      <StepActions onBack={props.onBack} />
    </form>
  );
};

/**
 * The embedder, local by default; the check compares its vectors with the database. A remote
 * one offers no list of models either, for want of a session.
 */
export const EmbedderStep = (props: SettingsStepProps) => {
  const { submit, runCheck, section } = stepHandlers('embedding', props);
  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <EmbedderSection
        values={props.values.embedding}
        issues={props.issues}
        onChange={section('embedding')}
        locked={false}
        check={props.check}
        onCheck={runCheck}
        listModels={false}
      />
      <p className="text-sm text-muted-foreground">
        The embedder cannot change once a document is stored. Its check also compares the length of
        its vectors with <code className="font-mono">EMBEDDING_DIM</code>, which the database was
        created with.
      </p>
      <StepActions onBack={props.onBack} />
    </form>
  );
};
