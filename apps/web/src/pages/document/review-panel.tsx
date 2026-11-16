import type { DocumentReview, DocumentView } from '@liasse/sdk';
import { type SubmitEvent, useState } from 'react';
import { errorMessage } from '../../api/errors.ts';
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
  readAgainOf,
  readReview,
  reclassificationOf,
  reasonSentences,
  type ReviewDraft,
  reviewedValues,
  valueKey,
  valueOf,
} from './review.ts';
import { TypeRow } from './review-type-row.tsx';
import { ValueRow } from './review-value-row.tsx';
import { useCorrectDocument } from './use-correct-document.ts';
import { useReclassifyDocument } from './use-reclassify-document.ts';

interface ReviewPanelProps {
  readonly document: DocumentView;
  readonly review: DocumentReview;
}

const submitLabel = (reanalysing: boolean, pending: boolean): string => {
  if (reanalysing) return pending ? 'Asking...' : 'Analyse the type again';
  return pending ? 'Saving...' : 'Submit review';
};

/**
 * The review of a flagged document: why it is flagged, its type and its doubtful values,
 * each accepted as it is unless the person rejects or edits it, sent as one correction.
 * Asking the model for the type again sends a reclassification instead, after which every
 * value is read again.
 */
export const ReviewPanel = ({ document, review }: ReviewPanelProps) => {
  const [draft, setDraft] = useState<ReviewDraft>(() => draftOfReview(document));
  const { correct, problems, setProblems } = useCorrectDocument(document.id);
  const reclassify = useReclassifyDocument(document.id);
  const reclassification = reclassificationOf(draft);
  const pending = correct.isPending || reclassify.isPending;
  const asked = reviewedValues(review);
  const others = otherValues(review);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reclassification !== null) {
      reclassify.mutate(reclassification);
      return;
    }
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
          {reclassify.isError ? (
            <p className="text-sm text-destructive">{errorMessage(reclassify.error)}</p>
          ) : null}
          <TypeRow
            current={document.type}
            type={review.type}
            draft={draft}
            onChange={(type) => {
              setDraft((current) => ({ ...current, ...type }));
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
                readAgain={readAgainOf(value, draft, document)}
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
            <Button type="submit" disabled={pending}>
              {submitLabel(reclassification !== null, pending)}
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
