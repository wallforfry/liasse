import type { DocumentView } from '@liasse/sdk';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { valueRowsOf } from './correction.ts';
import { ValuesForm } from './values-form.tsx';

/** The values of a document, edited with the inputs the fields of its type call for. */
export const ValuesCard = ({ document }: { readonly document: DocumentView }) => {
  const client = useClient();
  // The same list as the type picker, which leaves merged types out.
  const types = useQuery({ queryKey: ['types'], queryFn: async () => client.listTypes() });
  const definitions = types.data?.types.find(({ slug }) => slug === document.type)?.fields;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Values</CardTitle>
        <CardDescription>
          Change a value, or clear it to say the document has none. Only what you edit is sent, and
          a value corrected by hand is kept over what extraction finds later.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {types.isError ? (
          <p className="text-sm text-muted-foreground">
            The fields of the type could not be read ({errorMessage(types.error)}): their inputs are
            guessed from the values.
          </p>
        ) : null}
        {types.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ValuesForm document={document} rows={valueRowsOf(document, definitions)} />
        )}
      </CardContent>
    </Card>
  );
};
