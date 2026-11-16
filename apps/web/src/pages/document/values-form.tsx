import type { DocumentView } from '@liasse/sdk';
import { type SubmitEvent, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { plural } from '../../lib/format.ts';
import {
  changedRows,
  type Drafts,
  readCorrection,
  type ValueRow as Row,
  type ValueSection,
} from './correction.ts';
import { CorrectionProblems } from './correction-problems.tsx';
import { useCorrectDocument } from './use-correct-document.ts';
import { isEmptyDraft } from './value-drafts.ts';
import { ValueRow } from './value-row.tsx';

interface ValuesFormProps {
  readonly document: DocumentView;
  readonly rows: readonly Row[];
}

const SECTION_TITLES: Readonly<Record<ValueSection, string>> = {
  core: 'Core values',
  fields: 'Fields of the type',
};

const PendingChanges = ({
  rows,
  drafts,
}: {
  readonly rows: readonly Row[];
  readonly drafts: Drafts;
}) => {
  const changed = changedRows(rows, drafts);
  if (changed.length === 0) {
    return <p className="text-sm text-muted-foreground">No change yet.</p>;
  }
  const names = changed.map((row) => {
    const draft = drafts[row.key] ?? row.initial;
    return isEmptyDraft(draft) ? `${row.name} (cleared)` : row.name;
  });
  return (
    <p className="text-sm" aria-live="polite">
      {plural(changed.length, 'change')} to save: {names.join(', ')}
    </p>
  );
};

/** The values of a document, one input each; only the edited ones are sent. */
export const ValuesForm = ({ document, rows }: ValuesFormProps) => {
  const { correct, problems, setProblems } = useCorrectDocument(document.id);
  const [drafts, setDrafts] = useState<Drafts>({});

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reading = readCorrection(rows, drafts);
    if (reading.ok) correct.mutate(reading.correction);
    else setProblems(reading.problems);
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} aria-label="Values">
      {(['core', 'fields'] as const).map((section) => {
        const ofSection = rows.filter((row) => row.section === section);
        return (
          <section key={section} className="flex flex-col">
            <h3 className="text-sm font-semibold">{SECTION_TITLES[section]}</h3>
            {ofSection.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">None.</p>
            ) : (
              ofSection.map((row) => (
                <ValueRow
                  key={row.key}
                  row={row}
                  draft={drafts[row.key] ?? row.initial}
                  onChange={(draft) => {
                    setDrafts((current) => ({ ...current, [row.key]: draft }));
                  }}
                />
              ))
            )}
          </section>
        );
      })}
      <CorrectionProblems problems={problems} />
      <div className="flex flex-wrap items-center gap-4 border-t pt-4">
        <Button
          type="submit"
          disabled={correct.isPending || changedRows(rows, drafts).length === 0}
        >
          {correct.isPending ? 'Saving...' : 'Save the values'}
        </Button>
        <PendingChanges rows={rows} drafts={drafts} />
      </div>
    </form>
  );
};
