import { MAX_TYPE_DESCRIPTION_LENGTH } from '@liasse/contract/domain';
import type { TypeView } from '@liasse/sdk';
import { PlusIcon } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
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
import { emptyField, type FieldDraft, hasUnnamedRow, repeatedNames } from './field-drafts.ts';
import { FieldRow } from './field-row.tsx';
import { nextKeyOf, NO_PARENT, type TypeDraft } from './type-draft.ts';

interface TypeDraftFieldsProps {
  readonly draft: TypeDraft;
  readonly parents: readonly TypeView[];
  readonly onChange: (draft: TypeDraft) => void;
}

/** The inputs of a type: slug, description, parent and fields. */
export const TypeDraftFields = ({ draft, parents, onChange }: TypeDraftFieldsProps) => {
  const repeated = repeatedNames(draft.fields);
  const setFields = (fields: readonly FieldDraft[]) => {
    onChange({ ...draft, fields });
  };

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="type-slug">Slug</Label>
        <Input
          id="type-slug"
          required
          className="font-mono"
          value={draft.slug}
          onChange={(event) => {
            onChange({ ...draft, slug: event.target.value });
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
            onChange({ ...draft, description: event.target.value });
          }}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="type-parent">Parent</Label>
        <Select
          value={draft.parent}
          onValueChange={(parent) => {
            onChange({ ...draft, parent });
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
            setFields([...draft.fields, emptyField(nextKeyOf(draft.fields))]);
          }}
        >
          <PlusIcon />
          Add field
        </Button>
        {hasUnnamedRow(draft.fields) ? (
          <p className="text-sm text-muted-foreground">Name every field, or remove it.</p>
        ) : null}
        {repeated.length === 0 ? null : (
          <p className="text-sm text-destructive">
            Two fields have the same name: {repeated.join(', ')}.
          </p>
        )}
      </fieldset>
    </>
  );
};
