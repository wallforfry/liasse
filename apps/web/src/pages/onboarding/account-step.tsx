import {
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@liasse/contract/domain';
import type { SetupAccount } from '@liasse/contract';
import type { SubmitEvent } from 'react';
import { SettingsCard } from '../settings/settings-card.tsx';
import { TextField } from '../settings/settings-fields.tsx';
import { fieldSetter } from '../settings/settings-form.ts';
import { type Issues, issueAt, NO_ISSUES } from '../settings/settings-validation.ts';
import { type AccountValues, validateAccount } from './setup-validation.ts';
import { StepActions } from './step-actions.tsx';

interface AccountStepProps {
  readonly values: AccountValues;
  readonly issues: Issues;
  readonly onChange: (values: AccountValues) => void;
  readonly onIssues: (issues: Issues) => void;
  readonly onBack: () => void;
  readonly onNext: (account: SetupAccount) => void;
}

/** The first account, which signs in once the onboarding is done. */
export const AccountStep = ({
  values,
  issues,
  onChange,
  onIssues,
  onBack,
  onNext,
}: AccountStepProps) => {
  const set = fieldSetter(values, onChange);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateAccount(values);
    onIssues(validation.valid ? NO_ISSUES : validation.issues);
    if (validation.valid) onNext(validation.account);
  };
  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <SettingsCard
        id="setup-account"
        title="Your account"
        description="The account you sign in with, once the onboarding is done."
      >
        <TextField
          id="account-name"
          label="Name"
          autoComplete="name"
          maxLength={MAX_ACCOUNT_NAME_LENGTH}
          value={values.name}
          onChange={set('name')}
          error={issueAt(issues, 'name')}
        />
        <TextField
          id="account-email"
          label="Email"
          kind="email"
          autoComplete="username"
          value={values.email}
          onChange={set('email')}
          error={issueAt(issues, 'email')}
        />
        <TextField
          id="account-password"
          label="Password"
          kind="password"
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters.`}
          value={values.password}
          onChange={set('password')}
          error={issueAt(issues, 'password')}
        />
        <TextField
          id="account-confirmation"
          label="Password again"
          kind="password"
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          value={values.confirmation}
          onChange={set('confirmation')}
          error={issueAt(issues, 'confirmation')}
        />
      </SettingsCard>
      <StepActions onBack={onBack} />
    </form>
  );
};
