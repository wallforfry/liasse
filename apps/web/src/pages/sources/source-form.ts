import {
  type Source,
  type SourceCreate,
  sourceCreateSchema,
  type SourceCreateInput,
  type SourcePatch,
  sourcePatchSchema,
  type SourcePatchInput,
} from '@liasse/contract';
import { DEFAULT_SOURCE_POLL_MINUTES } from '@liasse/contract/domain';
import type { z } from 'zod';
import { number, numberText, optionalText, text } from '../settings/settings-form.ts';
import { type Issues, issuesFrom } from '../settings/settings-validation.ts';
import { changesOf } from './source-changes.ts';

/** The fields of the form every kind of source has, numbers as typed. */
export interface GeneralSourceValues {
  readonly name: string;
  readonly enabled: boolean;
  readonly poll_interval_minutes: string;
  /** Given with every document of the source. */
  readonly hint: string;
  readonly private: boolean;
}

export const newGeneralValues = (): GeneralSourceValues => ({
  name: '',
  enabled: true,
  poll_interval_minutes: numberText(DEFAULT_SOURCE_POLL_MINUTES),
  hint: '',
  private: false,
});

export const generalValuesOf = (source: Source): GeneralSourceValues => ({
  name: source.name,
  enabled: source.enabled,
  poll_interval_minutes: numberText(source.poll_interval_minutes),
  hint: text(source.hint ?? undefined),
  private: source.private,
});

const generalDraftOf = (values: GeneralSourceValues) => ({
  name: values.name,
  enabled: values.enabled,
  poll_interval_minutes: number(values.poll_interval_minutes),
  private: values.private,
});

/** The general fields as a create sends them: a blank hint is left out. */
export const generalCreateDraftOf = (values: GeneralSourceValues) => ({
  ...generalDraftOf(values),
  hint: optionalText(values.hint),
});

/** The general fields as a patch sends them: a blank hint removes the stored one. */
export const generalPatchDraftOf = (values: GeneralSourceValues) => ({
  ...generalDraftOf(values),
  hint: optionalText(values.hint) ?? null,
});

export type FormValidation<Draft> =
  | { readonly valid: true; readonly draft: Draft }
  | { readonly valid: false; readonly issues: Issues };

const validation = <Draft>(result: z.ZodSafeParseResult<Draft>): FormValidation<Draft> =>
  result.success
    ? { valid: true, draft: result.data }
    : {
        valid: false,
        issues: issuesFrom(
          result.error.issues.map(({ path, message }) => ({
            path: path.map(String).join('.'),
            message,
          })),
        ),
      };

/** A new source read by the schema the server creates it with. */
export const parseCreate = (draft: SourceCreateInput): FormValidation<SourceCreate> =>
  validation(sourceCreateSchema.safeParse(draft));

/**
 * A form of `source` read by the schema the server saves it with, as the fields it changes:
 * see `changesOf`. `draft` is of the kind of `source`.
 */
export const parsePatch = (
  draft: SourcePatchInput,
  source: Source,
): FormValidation<SourcePatch> => {
  const result = validation(sourcePatchSchema.safeParse(draft));
  return result.valid ? { valid: true, draft: changesOf(result.draft, source) } : result;
};
