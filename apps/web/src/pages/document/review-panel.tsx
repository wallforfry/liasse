import type { DocumentReview, DocumentView } from '@liasse/sdk';
import { type SubmitEvent, useState } from 'react';
import { Disclosure } from '../../components/disclosure.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';
import { CorrectionProblems } from './correction-problems.tsx';
import { ValueTable } from './document-parts.tsx';
import {
  ACCEPT,
  draftOfReview,
  otherValues,
  readReview,
  reasonSentences,
  type ReviewDraft,
  reviewedValues,
  valueKey,
  valueOf,
} from './review.ts';
import { TypeRow, ValueRow } from './review-rows.tsx';
import { useCorrection } from './use-correction.ts';

interface ReviewPanelProps {
  readonly document: DocumentView;
  readonly review: DocumentReview;
}

/**
 * The review of a flagged document: why it is flagged, its type and its doubtful values,
 * each accepted as it is unless the person rejects or edits it, sent as one correction.
 */
export const ReviewPanel = ({ document, review }: ReviewPanelProps) => {
  const [draft, setDraft] = useState<ReviewDraft>(() => draftOfReview(document));
  const correction = useCorrection(document.id, 'The review was saved.');
  const asked = reviewedValues(review);
  const others = otherValues(review);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reading = readReview(draft, document, review);
    if (reading.ok) correction.send(reading.correction);
    else correction.refuse(reading.problem);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>To review</CardTitle>
        <CardDescription>
          <ul className="list-inside list-disc">
            {reasonSentences(document, review).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit} aria-label="Review">
          <CorrectionProblems title="The review was not saved" problems={correction.problems} />
          <TypeRow
            current={document.type}
            type={review.type}
            value={draft.type}
            onChange={(type) => {
              setDraft((current) => ({ ...current, type }));
            }}
          />
          {asked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No value is in doubt.</p>
          ) : (
            asked.map((value) => (
              <ValueRow
                key={valueKey(value)}
                reviewed={value}
                current={valueOf(document, value)}
                decision={draft.decisions[valueKey(value)] ?? ACCEPT}
                onChange={(decision) => {
                  setDraft((current) => ({
                    ...current,
                    decisions: { ...current.decisions, [valueKey(value)]: decision },
                  }));
                }}
              />
            ))
          )}
          {others.length === 0 ? null : (
            <Disclosure label="Other values">
              <ValueTable
                values={Object.fromEntries(
                  others.map((value) => [value.name, valueOf(document, value)]),
                )}
              />
            </Disclosure>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={correction.pending}>
              {correction.pending ? 'Saving...' : 'Submit review'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(draftOfReview(document));
              }}
            >
              Accept all
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
