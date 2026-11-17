import type { SetupAccount } from '@liasse/contract';
import type { SubmitEvent } from 'react';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { SettingsCard } from '../settings/settings-card.tsx';
import { isLocalEmbedder, type KeyField, type SettingsValues } from '../settings/settings-form.ts';
import { StepActions } from './step-actions.tsx';

interface SummaryStepProps {
  readonly account: SetupAccount;
  readonly settings: SettingsValues;
  /** The refusal of the setup or of the sign-in after it, shown in place. */
  readonly refusal: unknown;
  readonly pending: boolean;
  readonly onBack: () => void;
  readonly onFinish: () => void;
}

// A key is never shown back, not even here: only whether one was given.
const keyText = ({ update }: KeyField): string =>
  update.action === 'replace' && update.value !== '' ? 'Given' : 'None';

const orDefault = (value: string, fallback: string): string =>
  value.trim() === '' ? fallback : value;

const Entry = ({ term, value }: { readonly term: string; readonly value: string }) => (
  <div className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
    <dt className="text-muted-foreground">{term}</dt>
    <dd className="break-all">{value}</dd>
  </div>
);

/** What the setup will save, before it does. */
export const SummaryStep = ({
  account,
  settings: { llm, embedding },
  refusal,
  pending,
  onBack,
  onFinish,
}: SummaryStepProps) => {
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onFinish();
  };
  const local = isLocalEmbedder(embedding.provider);
  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <SettingsCard
        id="setup-summary"
        title="Summary"
        description="Finishing creates the account, saves these settings and signs you in. The pipeline and Hindsight keep their defaults: change them later under Settings."
      >
        <dl aria-label="Account" className="flex flex-col gap-1">
          <Entry term="Name" value={account.name} />
          <Entry term="Email" value={account.email} />
        </dl>
        <dl aria-label="Language models" className="flex flex-col gap-1">
          <Entry term="Provider" value={llm.provider} />
          <Entry term="Text model" value={llm.text_model} />
          <Entry term="Vision model" value={llm.vision_model} />
          <Entry term="Base URL" value={orDefault(llm.base_url, "The provider's own")} />
          <Entry term="API key" value={keyText(llm.api_key)} />
        </dl>
        <dl aria-label="Embedder" className="flex flex-col gap-1">
          <Entry term="Provider" value={embedding.provider} />
          <Entry
            term="Model"
            value={orDefault(embedding.model, local ? 'The one the local embedder ships' : '')}
          />
          {local ? null : (
            <>
              <Entry term="Base URL" value={orDefault(embedding.base_url, "The provider's own")} />
              <Entry term="API key" value={keyText(embedding.api_key)} />
            </>
          )}
        </dl>
        {refusal === undefined ? null : <ErrorAlert error={refusal} title="Setup not finished" />}
      </SettingsCard>
      <StepActions
        onBack={onBack}
        pending={pending}
        submitLabel={pending ? 'Finishing...' : 'Finish and sign in'}
      />
    </form>
  );
};
