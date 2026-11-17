import { LLM_PROVIDERS } from '@liasse/contract/domain';
import { SectionCheck, type SettingsCheckMutation } from './check-results.tsx';
import { SecretField } from './secret-field.tsx';
import { SettingsCard } from './settings-card.tsx';
import { ChoiceField, TextField } from './settings-fields.tsx';
import { ModelOrTextField } from './model-field.tsx';
import { fieldSetter, llmModelsRequest, type SectionProps } from './settings-form.ts';
import { issueAt } from './settings-validation.ts';

interface LanguageModelsSectionProps extends SectionProps<'llm'> {
  readonly check: SettingsCheckMutation;
  readonly onCheck: () => void;
  /** Whether the model fields offer the list of the provider, which needs a session. */
  readonly listModels?: boolean;
}

export const LanguageModelsSection = ({
  values,
  issues,
  onChange,
  check,
  onCheck,
  listModels = true,
}: LanguageModelsSectionProps) => {
  const set = fieldSetter(values, onChange);
  const request = listModels ? llmModelsRequest(values) : undefined;
  return (
    <SettingsCard
      id="llm"
      title="Language models"
      description="The text model classifies, extracts and consolidates; the vision model reads images and scanned pages."
    >
      <ChoiceField
        id="llm-provider"
        label="Provider"
        options={LLM_PROVIDERS}
        value={values.provider}
        onChange={set('provider')}
        error={issueAt(issues, 'llm.provider')}
      />
      <ModelOrTextField
        id="llm-text-model"
        label="Text model"
        request={request}
        value={values.text_model}
        onChange={set('text_model')}
        error={issueAt(issues, 'llm.text_model')}
      />
      <ModelOrTextField
        id="llm-vision-model"
        label="Vision model"
        request={request}
        value={values.vision_model}
        onChange={set('vision_model')}
        error={issueAt(issues, 'llm.vision_model')}
      />
      <TextField
        id="llm-base-url"
        label="Base URL"
        kind="url"
        hint="Required for openai-compatible; leave empty for the provider's own endpoint."
        value={values.base_url}
        onChange={set('base_url')}
        error={issueAt(issues, 'llm.base_url')}
      />
      <SecretField
        id="llm-api-key"
        label="language model API key"
        field={values.api_key}
        onChange={set('api_key')}
        error={issueAt(issues, 'llm.api_key')}
      />
      <TextField
        id="llm-timeout"
        label="Timeout (ms)"
        kind="number"
        value={values.timeout_ms}
        onChange={set('timeout_ms')}
        error={issueAt(issues, 'llm.timeout_ms')}
      />
      <SectionCheck
        section="language models"
        parts={['text_model', 'vision_model']}
        check={check}
        onCheck={onCheck}
      />
    </SettingsCard>
  );
};
