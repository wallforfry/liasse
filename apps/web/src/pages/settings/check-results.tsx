import type { SettingsCheck, SettingsPartCheck } from '@liasse/sdk';
import type { SettingsDraft } from '@liasse/contract';
import type { UseMutationResult } from '@tanstack/react-query';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';

export type CheckedPart = keyof SettingsCheck;

const PART_LABELS: Readonly<Record<CheckedPart, string>> = {
  text_model: 'Text model',
  vision_model: 'Vision model',
  embedder: 'Embedder',
  hindsight: 'Hindsight',
};

const STATUS_LABELS: Readonly<Record<SettingsPartCheck['status'], string>> = {
  ok: 'Answered',
  skipped: 'Skipped',
  failed: 'Failed',
};

const PartResult = ({
  part,
  check,
}: {
  readonly part: CheckedPart;
  readonly check: SettingsPartCheck;
}) => (
  <li className="flex flex-wrap items-center gap-2 text-sm">
    <span className="font-medium">{PART_LABELS[part]}</span>
    <Badge variant={check.status === 'failed' ? 'destructive' : 'secondary'}>
      {STATUS_LABELS[check.status]}
    </Badge>
    {check.status === 'failed' ? (
      <span className="text-muted-foreground">{check.message}</span>
    ) : null}
  </li>
);

/** A check of the draft, which runs every part, unsaved. */
export type SettingsCheckMutation = UseMutationResult<SettingsCheck, Error, SettingsDraft>;

interface SectionCheckProps {
  /** Names the section in the button, such as `language models`. */
  readonly section: string;
  readonly parts: readonly CheckedPart[];
  readonly check: SettingsCheckMutation;
  /** Validates the form, then runs `check` on it. */
  readonly onCheck: () => void;
}

/** The check button of a section, and what the parts of that section answered. */
export const SectionCheck = ({ section, parts, check, onCheck }: SectionCheckProps) => (
  <div className="flex flex-col gap-2">
    <Button
      type="button"
      variant="outline"
      className="self-start"
      disabled={check.isPending}
      aria-label={`Check the ${section}`}
      onClick={onCheck}
    >
      {check.isPending ? 'Checking...' : 'Check'}
    </Button>
    {check.error === null ? null : <ErrorAlert error={check.error} title="Check not run" />}
    {/* Rendered while empty: a live region that appears with its content is not announced
        by every screen reader. */}
    <div role="status">
      {check.data === undefined ? null : (
        <ul aria-label={`Check of the ${section}`} className="flex flex-col gap-1">
          {parts.map((part) => (
            <PartResult key={part} part={part} check={check.data[part]} />
          ))}
        </ul>
      )}
    </div>
  </div>
);
