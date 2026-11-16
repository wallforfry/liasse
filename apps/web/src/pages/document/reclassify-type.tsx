import { MAX_HINT_LENGTH } from '@liasse/contract/domain';
import type { DocumentView } from '@liasse/sdk';
import { LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/errors.ts';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { isSettled } from '../../lib/processing.ts';
import { type UnderWay, useReclassification } from './use-reclassification.ts';

const UNDER_WAY_MESSAGES: Readonly<Record<Exclude<UnderWay, null>, string>> = {
  classifying: 'The model is deciding the type again. This page follows it.',
  extracting: 'The type changed: the values are being extracted again for it.',
};

const UnderWayAlert = ({ underWay }: { readonly underWay: UnderWay }) =>
  underWay === null ? null : (
    <Alert role="status">
      <LoaderCircleIcon className="animate-spin" />
      <AlertTitle>The analysis is under way</AlertTitle>
      <AlertDescription>{UNDER_WAY_MESSAGES[underWay]}</AlertDescription>
    </Alert>
  );

/** Asks the model for the type again, the current one being wrong, with what the person knows. */
export const ReclassifyType = ({ document }: { readonly document: DocumentView }) => {
  const { request, underWay } = useReclassification(document);
  const [hint, setHint] = useState('');
  const [newType, setNewType] = useState(false);
  const settled = isSettled(document);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">Analyse the type again</h3>
        <p className="text-sm text-muted-foreground">
          The model decides the type again without the one the document has now, then the values are
          extracted again for the new type.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="reclassify-hint">What the document is (optional)</Label>
        <Textarea
          id="reclassify-hint"
          placeholder="For example: a water bill, not an electricity bill"
          maxLength={MAX_HINT_LENGTH}
          value={hint}
          onChange={(event) => {
            setHint(event.target.value);
          }}
        />
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="reclassify-new-type"
          checked={newType}
          onCheckedChange={(checked) => {
            setNewType(checked === true);
          }}
        />
        <div className="grid gap-1">
          <Label htmlFor="reclassify-new-type">Create a new type</Label>
          <p className="text-xs text-muted-foreground">
            No type of the registry fits: the model creates one instead of choosing.
          </p>
        </div>
      </div>
      {request.isError ? (
        <p className="text-sm text-destructive">{errorMessage(request.error)}</p>
      ) : null}
      <UnderWayAlert underWay={underWay} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={!settled || request.isPending || underWay !== null}
          onClick={() => {
            const trimmed = hint.trim();
            request.mutate({
              ...(trimmed === '' ? {} : { hint: trimmed }),
              ...(newType ? { new_type: true } : {}),
            });
          }}
        >
          {request.isPending ? 'Asking...' : 'Analyse the type again'}
        </Button>
        {settled ? null : (
          <p className="text-sm text-muted-foreground">
            Possible once the document is indexed or waits for a review.
          </p>
        )}
      </div>
    </div>
  );
};
