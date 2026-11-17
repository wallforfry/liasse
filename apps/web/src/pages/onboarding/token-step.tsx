import { type SubmitEvent, useState } from 'react';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { SettingsCard } from '../settings/settings-card.tsx';
import { validateToken } from './setup-validation.ts';
import { StepActions } from './step-actions.tsx';

interface TokenStepProps {
  readonly token: string;
  readonly onChange: (token: string) => void;
  /** The refusal of the server that sent the person back here, such as a wrong token. */
  readonly refusal: unknown;
  readonly onNext: (token: string) => void;
}

/** The setup token: only whoever reads the logs of the server may create the first account. */
export const TokenStep = ({ token, onChange, refusal, onNext }: TokenStepProps) => {
  const [missing, setMissing] = useState(false);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateToken(token);
    setMissing(!validation.valid);
    if (validation.valid) onNext(validation.token);
  };
  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <SettingsCard
        id="setup-token"
        title="Setup token"
        description="Proves that you run this server: no account exists yet, so nothing else can."
      >
        <p className="text-sm">
          The server printed a setup token to its logs when it started, on the line that begins with{' '}
          <q>Notice: no account exists yet</q>. With Docker Compose, read it with{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            docker compose logs liasse
          </code>
          . A restart prints a new token, and the previous one no longer works.
        </p>
        {refusal === undefined ? null : <ErrorAlert error={refusal} title="Token refused" />}
        <div className="grid gap-2">
          <Label htmlFor="setup-token-input">Setup token</Label>
          <Input
            id="setup-token-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={token}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? 'setup-token-error' : undefined}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          {missing ? (
            <p id="setup-token-error" className="text-sm text-destructive">
              Paste the token the server printed.
            </p>
          ) : null}
        </div>
      </SettingsCard>
      <StepActions />
    </form>
  );
};
