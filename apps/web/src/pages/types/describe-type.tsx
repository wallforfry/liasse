import { MAX_TYPE_REQUEST_LENGTH } from '@liasse/contract/domain';
import type { TypeSuggestion } from '@liasse/sdk';
import { useMutation } from '@tanstack/react-query';
import { SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';

/** Asks the text model for a draft of the type a person describes; nothing is created. */
export const DescribeType = ({
  onSuggested,
}: {
  readonly onSuggested: (suggestion: TypeSuggestion) => void;
}) => {
  const client = useClient();
  const [request, setRequest] = useState('');
  const suggest = useMutation({
    mutationFn: async (text: string) => client.suggestType({ request: text }),
    onSuccess: onSuggested,
  });

  return (
    <div className="flex flex-col gap-4">
      {suggest.error === null ? null : (
        <ErrorAlert error={suggest.error} title="No type suggested" />
      )}
      <div className="grid gap-2">
        <Label htmlFor="type-request">What is the type for?</Label>
        <Textarea
          id="type-request"
          maxLength={MAX_TYPE_REQUEST_LENGTH}
          placeholder="Payslips from my employer: I want the gross and net pay, the period and the employer."
          value={request}
          onChange={(event) => {
            setRequest(event.target.value);
          }}
        />
        <p className="text-sm text-muted-foreground">
          The text model drafts the slug, the description, the parent and the fields. You review the
          draft before the type is created.
        </p>
      </div>
      <Button
        type="button"
        className="self-end"
        disabled={suggest.isPending || request.trim() === ''}
        onClick={() => {
          suggest.mutate(request);
        }}
      >
        <SparklesIcon />
        {suggest.isPending ? 'Drafting...' : 'Draft the type'}
      </Button>
    </div>
  );
};
