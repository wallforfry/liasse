import { MAX_API_KEY_LENGTH, type SecretState } from '@liasse/contract/domain';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import type { KeyField } from './settings-form.ts';

const STATE_LABELS: Readonly<Record<SecretState, string>> = {
  set: 'Set',
  unset: 'Not set',
  unreadable: 'Unreadable',
};

const STATE_BADGES = {
  set: 'secondary',
  unset: 'outline',
  unreadable: 'destructive',
} as const satisfies Readonly<Record<SecretState, string>>;

interface SecretFieldProps {
  readonly id: string;
  /** Names the key in its controls, such as `Hindsight API key`; the label shows `API key`. */
  readonly label: string;
  readonly field: KeyField;
  readonly onChange: (field: KeyField) => void;
  readonly error?: string | undefined;
}

/** A stored key is never shown: it is kept, replaced by a new value, or cleared. */
export const SecretField = ({ id, label, field, onChange, error }: SecretFieldProps) => {
  const { state, update } = field;
  const replaceVerb = state === 'unset' ? 'Set' : 'Replace';
  const keep = () => {
    onChange({ state, update: { action: 'keep' } });
  };
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="grid gap-2">
      <div className="flex items-center gap-2">
        {update.action === 'replace' ? (
          <Label id={`${id}-label`} htmlFor={id}>
            API key
          </Label>
        ) : (
          // No input to label while the key is kept or cleared: the text names the group.
          <span id={`${id}-label`} className="text-sm leading-none font-medium">
            API key
          </span>
        )}
        <Badge variant={STATE_BADGES[state]}>{STATE_LABELS[state]}</Badge>
      </div>
      {state === 'unreadable' && update.action === 'keep' ? (
        <p className="text-sm text-muted-foreground">
          The stored key was sealed under another AUTH_SECRET: replace or clear it.
        </p>
      ) : null}
      {update.action === 'keep' ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`${replaceVerb} the ${label}`}
            onClick={() => {
              onChange({ state, update: { action: 'replace', value: '' } });
            }}
          >
            {replaceVerb}
          </Button>
          {state === 'unset' ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Clear the ${label}`}
              onClick={() => {
                onChange({ state, update: { action: 'clear' } });
              }}
            >
              Clear
            </Button>
          )}
        </div>
      ) : null}
      {update.action === 'replace' ? (
        <div className="flex gap-2">
          <Input
            id={id}
            type="password"
            aria-label={label}
            autoComplete="off"
            maxLength={MAX_API_KEY_LENGTH}
            value={update.value}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : `${id}-error`}
            onChange={(event) => {
              onChange({ state, update: { action: 'replace', value: event.target.value } });
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Cancel the change of the ${label}`}
            onClick={keep}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {update.action === 'clear' ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Cleared when the settings are saved.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Cancel the change of the ${label}`}
            onClick={keep}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {error === undefined ? null : (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
};
