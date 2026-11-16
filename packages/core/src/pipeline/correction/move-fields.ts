import { ownValue } from '@liasse/contract/registry';
import type { RegisteredType } from '../../registry/type-store.ts';
import { validateDocumentFields } from '../../registry/validate-document-fields.ts';
import type { PipelineDocument } from '../document.ts';

type Values = Readonly<Record<string, unknown>>;

const fitsField = (type: RegisteredType | undefined, name: string, value: unknown): boolean => {
  const definition = type === undefined ? undefined : ownValue(type.fields, name);
  return (
    definition !== undefined &&
    validateDocumentFields({ fields: { [name]: definition } }, { [name]: value }).ok
  );
};

export interface MovedFields {
  readonly fields: Values;
  readonly extra: Values;
}

/**
 * On a change of type, a value of the old type stays a field when the new type has a
 * field of that name it is valid for, and goes to `extra` otherwise, with its provenance
 * and its manual mark. Only a manual value is kept for good: the re-extraction keeps it
 * wherever it is, and replaces `extra` otherwise, since the text can give the other
 * values back.
 */
export const moveFields = (
  stored: Pick<PipelineDocument, 'fields' | 'extra'>,
  type: RegisteredType | undefined,
): MovedFields => {
  const entries = Object.entries(stored.fields);
  return {
    fields: Object.fromEntries(entries.filter(([name, value]) => fitsField(type, name, value))),
    extra: {
      ...stored.extra,
      ...Object.fromEntries(entries.filter(([name, value]) => !fitsField(type, name, value))),
    },
  };
};
