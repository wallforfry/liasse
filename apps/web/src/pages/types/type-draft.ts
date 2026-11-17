import type { FieldDefinition } from '@liasse/contract/registry';
import type { CreateTypeRequest, TypeSuggestion } from '@liasse/sdk';
import { type FieldDraft, fieldDraftOf, fieldsOf } from './field-drafts.ts';

// Radix Select keeps the empty string for clearing the selection.
export const NO_PARENT = '-';

/** What the creation form shows, whether typed by hand or drafted by the text model. */
export interface TypeDraft {
  readonly slug: string;
  readonly description: string;
  readonly parent: string;
  readonly fields: readonly FieldDraft[];
}

export const EMPTY_DRAFT: TypeDraft = { slug: '', description: '', parent: NO_PARENT, fields: [] };

export const requestOf = ({ slug, description, parent, fields }: TypeDraft): CreateTypeRequest => ({
  slug: slug.trim(),
  description,
  parent_slug: parent === NO_PARENT ? null : parent,
  fields: fieldsOf(fields),
});

// The form separates the values of an enum with commas, so it cannot show one that holds
// a comma: sent back, that value would come out as two.
const fitsTheForm = (definition: FieldDefinition): boolean => {
  const scalar = definition.type === 'list' ? definition.items : definition;
  return scalar.type !== 'enum' || scalar.values.every((value) => !value.includes(','));
};

export interface DraftedType {
  readonly draft: TypeDraft;
  /** Fields of the suggestion the form cannot show, by name. */
  readonly leftOut: readonly string[];
}

export const draftOf = ({
  slug,
  description,
  parent_slug,
  fields,
}: TypeSuggestion): DraftedType => {
  const entries = Object.entries(fields);
  return {
    draft: {
      slug,
      description,
      parent: parent_slug ?? NO_PARENT,
      fields: entries
        .filter(([, definition]) => fitsTheForm(definition))
        .map(([name, definition], key) => fieldDraftOf(key, name, definition)),
    },
    leftOut: entries.filter(([, definition]) => !fitsTheForm(definition)).map(([name]) => name),
  };
};

/** A key no row of the draft holds, for the next row added. */
export const nextKeyOf = (fields: readonly FieldDraft[]): number =>
  fields.reduce((next, { key }) => Math.max(next, key + 1), 0);
