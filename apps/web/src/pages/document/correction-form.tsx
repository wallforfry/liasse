import { LiasseApiError, type DocumentView } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type SubmitEvent, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { type CorrectionDraft, draftOf, readCorrection } from './correction.ts';

// `invalid_correction` lists what the registry refused, one message per value.
const problemsOf = (error: unknown): readonly string[] => {
  if (!(error instanceof LiasseApiError)) return [];
  const { errors } = error.details;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((item: unknown) =>
    typeof item === 'object' &&
    item !== null &&
    'message' in item &&
    typeof item.message === 'string'
      ? [item.message]
      : [],
  );
};

export const CorrectionForm = ({ document }: { readonly document: DocumentView }) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CorrectionDraft>(() => draftOf(document));
  const [problems, setProblems] = useState<readonly string[]>([]);
  const correct = useMutation({
    mutationFn: async (correction: Parameters<typeof client.correctDocument>[1]) =>
      client.correctDocument(document.id, correction),
    // The page gives the form a new key once the document is read again, which resets it.
    onSuccess: async () => {
      toast.success('The correction was saved. The document is processed again.');
      setProblems([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['document', document.id] }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
      ]);
    },
    onError: (error) => {
      setProblems([errorMessage(error), ...problemsOf(error)]);
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reading = readCorrection(draft, document);
    if (reading.ok) correct.mutate(reading.correction);
    else setProblems([reading.problem]);
  };

  const edit = (change: Partial<CorrectionDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
  };

  return (
    <form className="flex max-w-2xl flex-col gap-4" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        Only what differs from the values shown is sent, and it is kept over what extraction finds.
      </p>
      {problems.length === 0 ? null : (
        <Alert variant="destructive">
          <AlertTitle>The correction was not saved</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="correction-type">Type</Label>
        <Input
          id="correction-type"
          value={draft.type}
          onChange={(event) => {
            edit({ type: event.target.value });
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
        <Button type="submit" disabled={correct.isPending}>
          {correct.isPending ? 'Saving...' : 'Save the correction'}
        </Button>
      </div>
    </form>
  );
};
