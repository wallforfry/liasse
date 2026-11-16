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
  extractedAgain,
  otherValues,
  readReview,
  reasonSentences,
  type ReviewDraft,
  reviewedValues,
  valueKey,
  valueOf,
} from './review.ts';
import { TypeRow, ValueRow } from './review-rows.tsx';
import { useCorrectDocument } from './use-correct-document.ts';

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
  const { correct, problems, setProblems } = useCorrectDocument(document.id);
  const asked = reviewedValues(review);
  const others = otherValues(review);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reading = readReview(draft, document, review);
    if (reading.ok) correct.mutate(reading.correction);
    else setProblems([reading.problem]);
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
          <CorrectionProblems problems={problems} />
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
                extractedAgain={extractedAgain(value, draft, document)}
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
            <Button type="submit" disabled={correct.isPending}>
              {correct.isPending ? 'Saving...' : 'Submit review'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(draftOfReview(document));
              }}
            >
              Set all to Accept
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
