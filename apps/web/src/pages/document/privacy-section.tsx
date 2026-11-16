import type { DocumentView } from '@liasse/sdk';
import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { CorrectionProblems } from './correction-problems.tsx';
import { useCorrectDocument } from './use-correct-document.ts';

export const PrivacySection = ({ document }: { readonly document: DocumentView }) => {
  const { correct, problems } = useCorrectDocument(document.id);
  const [isPrivate, setPrivate] = useState(document.private);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy</CardTitle>
        <CardDescription>
          A private document is left out of search, Hindsight and external embeddings unless they
          are asked for.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="correction-private"
              checked={isPrivate}
              onCheckedChange={(checked) => {
                setPrivate(checked === true);
              }}
            />
            <Label htmlFor="correction-private">Private</Label>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPrivate === document.private || correct.isPending}
            onClick={() => {
              correct.mutate({ private: isPrivate });
            }}
          >
            {correct.isPending ? 'Saving...' : 'Save the privacy'}
          </Button>
        </div>
        <CorrectionProblems problems={problems} />
      </CardContent>
    </Card>
  );
};
