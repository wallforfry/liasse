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

export const draftOf = ({ slug, description, parent_slug, fields }: TypeSuggestion): TypeDraft => ({
  slug,
  description,
  parent: parent_slug ?? NO_PARENT,
  fields: Object.entries(fields).map(([name, definition], key) =>
    fieldDraftOf(key, name, definition),
  ),
});

/** A key no row of the draft holds, for the next row added. */
export const nextKeyOf = (fields: readonly FieldDraft[]): number =>
  fields.reduce((next, { key }) => Math.max(next, key + 1), 0);
