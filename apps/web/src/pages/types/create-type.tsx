import type { CreateTypeRequest, TypeView } from '@liasse/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx';
import { DescribeType } from './describe-type.tsx';
import { hasUnnamedRow, repeatedNames } from './field-drafts.ts';
import { draftOf, EMPTY_DRAFT, requestOf, type TypeDraft } from './type-draft.ts';
import { TypeDraftFields } from './type-draft-fields.tsx';
import { TYPES_QUERY_KEY, typePath } from './types-query.ts';

type Mode = 'describe' | 'define';

const isMode = (value: string): value is Mode => value === 'describe' || value === 'define';

const isComplete = (draft: TypeDraft): boolean =>
  draft.slug.trim() !== '' &&
  draft.description.trim() !== '' &&
  repeatedNames(draft.fields).length === 0 &&
  !hasUnnamedRow(draft.fields);

/**
 * Creates a type, described in a sentence for the text model to draft, or defined by
 * hand. Either way the person sends the definition, and the registry judges it with the
 * rules it applies to the pipeline; its refusal names every broken rule.
 */
export const CreateType = ({ roots }: { readonly roots: readonly TypeView[] }) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('describe');
  const [draft, setDraft] = useState<TypeDraft>(EMPTY_DRAFT);
  const [drafted, setDrafted] = useState<readonly string[] | null>(null);
  const create = useMutation({
    mutationFn: async (request: CreateTypeRequest) => client.createType(request),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: TYPES_QUERY_KEY });
      setOpen(false);
      setMode('describe');
      setDraft(EMPTY_DRAFT);
      setDrafted(null);
      create.reset();
      toast.success(`The type ${created.slug} was created.`);
      await navigate(typePath(created.slug));
    },
  });
  const parents = roots.filter(({ parent_slug }) => parent_slug === null);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(requestOf(draft));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          Create type
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a type</DialogTitle>
          <DialogDescription>
            Generic to specific, in snake_case: energy_bill, never edf_october. The type starts
            provisional, like one the pipeline creates, and counts towards the daily quota of new
            types the pipeline may create.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            if (isMode(value)) setMode(value);
          }}
        >
          <TabsList>
            <TabsTrigger value="describe">Describe it</TabsTrigger>
            <TabsTrigger value="define">Define it</TabsTrigger>
          </TabsList>
          <TabsContent value="describe" className="pt-2">
            <DescribeType
              onSuggested={(suggestion) => {
                const { draft: suggested, leftOut } = draftOf(suggestion);
                setDraft(suggested);
                setDrafted(leftOut);
                setMode('define');
              }}
            />
          </TabsContent>
          <TabsContent value="define" className="pt-2">
            <form className="flex flex-col gap-4" onSubmit={submit}>
              {drafted === null ? null : (
                <p className="text-sm text-muted-foreground">
                  Drafted by the text model: review it, then create the type.
                  {drafted.length === 0
                    ? null
                    : ` Left out, since an enum value holds a comma: ${drafted.join(', ')}.`}
                </p>
              )}
              {create.error === null ? null : (
                <ErrorAlert error={create.error} title="Type not created" />
              )}
              <TypeDraftFields draft={draft} parents={parents} onChange={setDraft} />
              <Button
                type="submit"
                className="self-end"
                disabled={create.isPending || !isComplete(draft)}
              >
                {create.isPending ? 'Creating...' : 'Create'}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
