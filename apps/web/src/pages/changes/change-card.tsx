import type { ChangeDecisionRequest, ChangeView } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { formatTime } from '../../lib/format.ts';

type Decision = ChangeDecisionRequest['decision'];

const MAX_NOTE_LENGTH = 2000;

const DECISIONS: Readonly<
  Record<Decision, { readonly label: string; readonly question: string; readonly done: string }>
> = {
  apply: {
    label: 'Apply',
    question: 'Apply this change?',
    done: 'The change was applied.',
  },
  reject: {
    label: 'Reject',
    question: 'Reject this change?',
    done: 'The change was rejected.',
  },
};

const DecisionButton = ({
  decision,
  disabled,
  onConfirm,
}: {
  readonly decision: Decision;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant={decision === 'apply' ? 'default' : 'outline'} disabled={disabled}>
        {DECISIONS[decision].label}
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{DECISIONS[decision].question}</AlertDialogTitle>
        <AlertDialogDescription>
          A decided change leaves the queue for good. Applying it rewrites the registry and queues
          the documents it touches for a new extraction.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>{DECISIONS[decision].label}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

// The rationale and the payload were written by a model from documents: text only.
export const ChangeCard = ({ change }: { readonly change: ChangeView }) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: async (decision: Decision) =>
      client.decideChange(change.id, {
        decision,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
    onSuccess: async ({ refusal }, decision) => {
      if (refusal === undefined) toast.success(DECISIONS[decision].done);
      else toast.warning(`The change could not be applied, so it was rejected: ${refusal.message}`);
      await queryClient.invalidateQueries({ queryKey: ['changes'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Badge>{change.kind.replaceAll('_', ' ')}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{change.id}</span>
        </CardTitle>
        <CardDescription>
          Proposed {formatTime(change.created_at)}.{' '}
          {change.auto
            ? 'Safe by the auto-apply policy.'
            : 'Needs an approval by the auto-apply policy.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed">{change.rationale}</p>
        <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {JSON.stringify(change.payload, null, 2)}
        </pre>
        <div className="grid gap-2">
          <Label htmlFor={`note-${change.id}`}>Note (optional)</Label>
          <Input
            id={`note-${change.id}`}
            maxLength={MAX_NOTE_LENGTH}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        {(['apply', 'reject'] as const).map((decision) => (
          <DecisionButton
            key={decision}
            decision={decision}
            disabled={decide.isPending}
            onConfirm={() => {
              decide.mutate(decision);
            }}
          />
        ))}
      </CardFooter>
    </Card>
  );
};
