import type { DocumentView } from '@liasse/sdk';
import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Label } from '../../components/ui/label.tsx';
import { CorrectionProblems } from './correction-problems.tsx';
import { TypePicker } from './type-picker.tsx';
import { useCorrectDocument } from './use-correct-document.ts';

/** The type of a document, chosen from the registry: a correction like any other. */
export const ManualType = ({ document }: { readonly document: DocumentView }) => {
  const { correct, problems } = useCorrectDocument(document.id);
  const [type, setType] = useState(document.type ?? '');
  const changed = type !== '' && type !== document.type;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1">
        <Label htmlFor="correction-type">Choose the type by hand</Label>
        <p className="text-sm text-muted-foreground">
          The type you choose is kept as a correction. Values that do not fit it move to the extra
          values, and the document is extracted again for it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TypePicker id="correction-type" value={type} onChange={setType} />
        <Button
          type="button"
          disabled={!changed || correct.isPending}
          onClick={() => {
            correct.mutate({ type });
          }}
        >
          {correct.isPending ? 'Saving...' : 'Save the type'}
        </Button>
      </div>
      <CorrectionProblems problems={problems} />
    </div>
  );
};
