import { EraserIcon, Undo2Icon } from 'lucide-react';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Label } from '../../components/ui/label.tsx';
import { shownValue } from '../../lib/format.ts';
import type { ValueRow as Row } from './correction.ts';
import { emptyDraft, isEmptyDraft, sameDraft, type ValueDraft } from './value-drafts.ts';
import { ValueEditor } from './value-editor.tsx';

interface ValueRowProps {
  readonly row: Row;
  readonly draft: ValueDraft;
  readonly onChange: (draft: ValueDraft) => void;
}

const CurrentValue = ({ value }: { readonly value: unknown }) => (
  <p className="text-xs break-words text-muted-foreground">
    {value === undefined || value === null ? 'No value now.' : `Now: ${shownValue(value)}`}
  </p>
);

/** One value of the document: its name, what it is now, its input and its actions. */
export const ValueRow = ({ row, draft, onChange }: ValueRowProps) => {
  const id = `value-${row.key}`;
  const changed = !sameDraft(draft, row.initial);
  // A value its editor cannot show, such as a malformed amount, is still shown as it is.
  const hidden = isEmptyDraft(row.initial) && row.current !== undefined && row.current !== null;
  return (
    <div className="grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="font-mono text-sm">
          {row.name}
        </Label>
        <div className="flex flex-wrap gap-1">
          {row.manual ? <Badge variant="secondary">corrected by hand</Badge> : null}
          {changed ? <Badge variant="outline">edited</Badge> : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-start gap-1">
          <div className="min-w-0 flex-1">
            <ValueEditor
              id={id}
              name={row.name}
              editor={row.editor}
              draft={draft}
              onChange={onChange}
            />
          </div>
          {isEmptyDraft(draft) ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Clear ${row.name}`}
              title="Clear the value"
              onClick={() => {
                onChange(emptyDraft(row.editor));
              }}
            >
              <EraserIcon />
            </Button>
          )}
          {changed ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Undo the edit of ${row.name}`}
              title="Undo the edit"
              onClick={() => {
                onChange(row.initial);
              }}
            >
              <Undo2Icon />
            </Button>
          ) : null}
        </div>
        {changed || hidden ? <CurrentValue value={row.current} /> : null}
      </div>
    </div>
  );
};
