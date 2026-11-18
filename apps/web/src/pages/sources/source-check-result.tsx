import type { SourceCheck } from '@liasse/sdk';
import { ErrorAlert } from '../../components/error-alert.tsx';

const CheckAnswer = ({ check }: { readonly check: SourceCheck }) => {
  if (!check.ok) {
    return <p className="text-sm text-destructive">Check failed: {check.error.message}</p>;
  }
  if (check.items.length === 0) {
    return <p className="text-sm">Connected. The next run has nothing new to take.</p>;
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>Connected. The next run would take, oldest first:</p>
      <ul aria-label="Next items" className="list-disc pl-5 text-muted-foreground">
        {check.items.map(({ name }, index) => (
          // Two messages may share a subject: the position tells them apart.
          <li key={index}>{name}</li>
        ))}
      </ul>
    </div>
  );
};

interface SourceCheckResultProps {
  readonly data: SourceCheck | undefined;
  readonly error: Error | null;
}

/** What a check of the stored credentials answered. Item names are untrusted text. */
export const SourceCheckResult = ({ data, error }: SourceCheckResultProps) => (
  <>
    {error === null ? null : <ErrorAlert error={error} title="Check not run" />}
    {/* Rendered while empty: a live region that appears with its content is not announced
        by every screen reader. */}
    <div role="status">{data === undefined ? null : <CheckAnswer check={data} />}</div>
  </>
);
