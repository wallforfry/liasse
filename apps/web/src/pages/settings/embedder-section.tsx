import { EMBEDDING_PROVIDERS } from '@liasse/contract/domain';
import { LockKeyholeIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { SectionCheck, type SettingsCheckMutation } from './check-results.tsx';
import { SecretField } from '../../components/secret-field.tsx';
import { SettingsCard } from './settings-card.tsx';
import { ChoiceField, TextField } from './settings-fields.tsx';
import { ModelOrTextField } from './model-field.tsx';
import {
  embeddingModelsRequest,
  fieldSetter,
  isLocalEmbedder,
  type SectionProps,
} from './settings-form.ts';
import { issueAt } from './settings-validation.ts';

interface EmbedderSectionProps extends SectionProps<'embedding'> {
  /** A live document exists: the server refuses another provider or model. */
  readonly locked: boolean;
  readonly check: SettingsCheckMutation;
  readonly onCheck: () => void;
  /** Whether the model field offers the list of the provider, which needs a session. */
  readonly listModels?: boolean;
}

const EmbedderLock = () => (
  <Alert>
    <LockKeyholeIcon />
    <AlertTitle>Provider and model are locked</AlertTitle>
    <AlertDescription>
      Documents exist, and their stored vectors come from this embedder: another one could not
      compare with them.
    </AlertDescription>
  </Alert>
);

export const EmbedderSection = ({
  values,
  issues,
  onChange,
  locked,
  check,
  onCheck,
  listModels = true,
}: EmbedderSectionProps) => {
  const set = fieldSetter(values, onChange);
  const remote = !isLocalEmbedder(values.provider);
  const request = listModels ? embeddingModelsRequest(values) : undefined;
  return (
    <SettingsCard
      id="embedding"
      title="Embedder"
      description="Turns passages into vectors for search. The local one runs in the server."
    >
      {locked ? <EmbedderLock /> : null}
      <ChoiceField
        id="embedding-provider"
        label="Provider"
        options={EMBEDDING_PROVIDERS}
        value={values.provider}
        onChange={set('provider')}
        disabled={locked}
        error={issueAt(issues, 'embedding.provider')}
      />
      <ModelOrTextField
        id="embedding-model"
        label="Model"
        hint={remote ? undefined : 'Leave empty for the model the local embedder ships.'}
        request={request}
        value={values.model}
        onChange={set('model')}
        disabled={locked}
        error={issueAt(issues, 'embedding.model')}
      />
      {remote ? (
        <>
          <TextField
            id="embedding-base-url"
            label="Base URL"
            kind="url"
            hint="Required for openai-compatible; leave empty for the provider's own endpoint."
            value={values.base_url}
            onChange={set('base_url')}
            error={issueAt(issues, 'embedding.base_url')}
          />
          <SecretField
            title="API key"
            noun="key"
            id="embedding-api-key"
            label="embedder API key"
            field={values.api_key}
            onChange={set('api_key')}
            error={issueAt(issues, 'embedding.api_key')}
          />
          <TextField
            id="embedding-max-input-tokens"
            label="Max input tokens"
            kind="number"
            hint="Tokens the model reads per input; leave empty for the default."
            value={values.max_input_tokens}
            onChange={set('max_input_tokens')}
            error={issueAt(issues, 'embedding.max_input_tokens')}
          />
        </>
      ) : null}
      <TextField
        id="embedding-timeout"
        label="Timeout (ms)"
        kind="number"
        value={values.timeout_ms}
        onChange={set('timeout_ms')}
        error={issueAt(issues, 'embedding.timeout_ms')}
      />
      <SectionCheck section="embedder" parts={['embedder']} check={check} onCheck={onCheck} />
    </SettingsCard>
  );
};
