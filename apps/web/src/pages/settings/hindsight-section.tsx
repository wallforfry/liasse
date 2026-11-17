import { SectionCheck, type SettingsCheckMutation } from './check-results.tsx';
import { SecretField } from './secret-field.tsx';
import { SettingsCard } from './settings-card.tsx';
import { TextField } from './settings-fields.tsx';
import { fieldSetter, issueAt, type SectionProps } from './settings-form.ts';

interface HindsightSectionProps extends SectionProps<'hindsight'> {
  readonly check: SettingsCheckMutation;
  readonly onCheck: () => void;
}

export const HindsightSection = ({
  values,
  issues,
  onChange,
  check,
  onCheck,
}: HindsightSectionProps) => {
  const set = fieldSetter(values, onChange);
  return (
    <SettingsCard
      id="hindsight"
      title="Hindsight"
      description="Optional: the facts of each document are kept in a Hindsight bank."
    >
      <TextField
        id="hindsight-url"
        label="URL"
        kind="url"
        hint="The integration is off without it."
        value={values.url}
        onChange={set('url')}
        error={issueAt(issues, 'hindsight.url')}
      />
      <TextField
        id="hindsight-bank"
        label="Bank"
        value={values.bank}
        onChange={set('bank')}
        error={issueAt(issues, 'hindsight.bank')}
      />
      <SecretField
        id="hindsight-api-key"
        label="Hindsight API key"
        field={values.api_key}
        onChange={set('api_key')}
        error={issueAt(issues, 'hindsight.api_key')}
      />
      <SectionCheck section="Hindsight" parts={['hindsight']} check={check} onCheck={onCheck} />
    </SettingsCard>
  );
};
