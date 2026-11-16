import type { DocumentView } from '@liasse/sdk';
import { type SubmitEvent, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { CorrectionProblems } from './correction-problems.tsx';
import { type CorrectionDraft, draftOf, readCorrection } from './correction.ts';
import { TypePicker } from './type-picker.tsx';
import { useCorrection } from './use-correction.ts';

export const CorrectionForm = ({ document }: { readonly document: DocumentView }) => {
  const [draft, setDraft] = useState<CorrectionDraft>(() => draftOf(document));
  const correction = useCorrection(
    document.id,
    'The correction was saved. The document is processed again.',
  );

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reading = readCorrection(draft, document);
    if (reading.ok) correction.send(reading.correction);
    else correction.refuse(reading.problem);
  };

  const edit = (change: Partial<CorrectionDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
  };

  return (
    <form className="flex max-w-2xl flex-col gap-4" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        Only what differs from the values shown is sent, and it is kept over what extraction finds.
      </p>
      <CorrectionProblems title="The correction was not saved" problems={correction.problems} />
      <div className="grid gap-2">
        <Label htmlFor="correction-type">Type</Label>
        <TypePicker
          id="correction-type"
          value={draft.type}
          onChange={(type) => {
            edit({ type });
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="correction-private"
          checked={draft.private}
          onCheckedChange={(checked) => {
            edit({ private: checked === true });
          }}
        />
        <Label htmlFor="correction-private">Private</Label>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="correction-core">Core values (JSON)</Label>
        <Textarea
          id="correction-core"
          className="min-h-40 font-mono text-xs"
          value={draft.core}
          onChange={(event) => {
            edit({ core: event.target.value });
          }}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="correction-fields">Fields (JSON)</Label>
        <Textarea
          id="correction-fields"
          className="min-h-40 font-mono text-xs"
          value={draft.fields}
          onChange={(event) => {
            edit({ fields: event.target.value });
          }}
        />
      </div>
      <div>
        <Button type="submit" disabled={correction.pending}>
          {correction.pending ? 'Saving...' : 'Save the correction'}
        </Button>
      </div>
    </form>
  );
};
