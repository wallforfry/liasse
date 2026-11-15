import { MAX_TYPE_DESCRIPTION_LENGTH } from '@liasse/contract/domain';
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
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { emptyField, type FieldDraft, fieldsOf, repeatedNames } from './field-drafts.ts';
import { FieldRow } from './field-row.tsx';
import { TYPES_QUERY_KEY, typePath } from './types-query.ts';

// Radix Select keeps the empty string for clearing the selection.
const NO_PARENT = '-';

interface Draft {
  readonly slug: string;
  readonly description: string;
  readonly parent: string;
  readonly fields: readonly FieldDraft[];
}

const EMPTY_DRAFT: Draft = { slug: '', description: '', parent: NO_PARENT, fields: [] };

const requestOf = ({ slug, description, parent, fields }: Draft): CreateTypeRequest => ({
  slug: slug.trim(),
  description,
  parent_slug: parent === NO_PARENT ? null : parent,
  fields: fieldsOf(fields),
});

/**
 * Creates a type by hand. The registry judges the request with the rules it applies to
 * the pipeline, and its refusal names every broken rule.
 */
export const CreateType = ({ roots }: { readonly roots: readonly TypeView[] }) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [nextKey, setNextKey] = useState(0);
  const create = useMutation({
    mutationFn: async (request: CreateTypeRequest) => client.createType(request),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: TYPES_QUERY_KEY });
      setOpen(false);
      setDraft(EMPTY_DRAFT);
      create.reset();
      toast.success(`The type ${created.slug} was created.`);
      await navigate(typePath(created.slug));
    },
  });
  const repeated = repeatedNames(draft.fields);
  const parents = roots.filter(({ parent_slug }) => parent_slug === null);

  const setFields = (fields: readonly FieldDraft[]) => {
    setDraft({ ...draft, fields });
  };
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
      <DialogContent className="sm:max-w-2xl">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create a type</DialogTitle>
            <DialogDescription>
              Generic to specific, in snake_case: energy_bill, never edf_october. The type starts
              provisional, like one the pipeline creates.
            </DialogDescription>
          </DialogHeader>
          {create.error === null ? null : (
            <ErrorAlert error={create.error} title="Type not created" />
          )}
          <div className="grid gap-2">
            <Label htmlFor="type-slug">Slug</Label>
            <Input
              id="type-slug"
              required
              className="font-mono"
              value={draft.slug}
              onChange={(event) => {
                setDraft({ ...draft, slug: event.target.value });
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="type-description">Description</Label>
            <Textarea
              id="type-description"
              required
              maxLength={MAX_TYPE_DESCRIPTION_LENGTH}
              value={draft.description}
              onChange={(event) => {
                setDraft({ ...draft, description: event.target.value });
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="type-parent">Parent</Label>
            <Select
              value={draft.parent}
              onValueChange={(parent) => {
                setDraft({ ...draft, parent });
              }}
            >
              <SelectTrigger id="type-parent" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>None</SelectItem>
                {parents.map(({ slug }) => (
                  <SelectItem key={slug} value={slug}>
                    {slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Fields</legend>
            {draft.fields.map((field, index) => (
              <FieldRow
                key={field.key}
                index={index}
                draft={field}
                onChange={(changed) => {
                  setFields(draft.fields.map((row) => (row.key === field.key ? changed : row)));
                }}
                onRemove={() => {
                  setFields(draft.fields.filter((row) => row.key !== field.key));
                }}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              className="justify-self-start"
              onClick={() => {
                setFields([...draft.fields, emptyField(nextKey)]);
                setNextKey(nextKey + 1);
              }}
            >
              <PlusIcon />
              Add field
            </Button>
            {repeated.length === 0 ? null : (
              <p className="text-sm text-destructive">
                Two fields have the same name: {repeated.join(', ')}.
              </p>
            )}
          </fieldset>
          <Button
            type="submit"
            className="self-end"
            disabled={
              create.isPending ||
              draft.slug.trim() === '' ||
              draft.description.trim() === '' ||
              repeated.length > 0
            }
          >
            {create.isPending ? 'Creating...' : 'Create'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
