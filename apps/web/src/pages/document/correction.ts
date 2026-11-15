import type { DocumentCorrection, DocumentView } from '@liasse/sdk';

export interface CorrectionDraft {
  readonly type: string;
  readonly private: boolean;
  /** JSON objects, as edited. */
  readonly core: string;
  readonly fields: string;
}

export type CorrectionReading =
  | { readonly ok: true; readonly correction: DocumentCorrection }
  | { readonly ok: false; readonly problem: string };

type Values = Readonly<Record<string, unknown>>;

const isValues = (value: unknown): value is Values =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pretty = (values: Values | undefined): string => JSON.stringify(values ?? {}, null, 2);

export const draftOf = (document: DocumentView): CorrectionDraft => ({
  type: document.type ?? '',
  private: document.private,
  core: pretty(document.core),
  fields: pretty(document.fields),
});

const readObject = (text: string, label: string): Values | string => {
  if (text.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isValues(parsed) ? parsed : `${label} must be a JSON object.`;
  } catch {
    return `${label} are not valid JSON.`;
  }
};

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

// Only the values the person changed: one sent unchanged would be marked as corrected by
// hand, and a masked identifier sent back would replace the real one. A value removed
// from the text is cleared.
const changedValues = (edited: Values, current: Values): Values | undefined => {
  const names = [...new Set([...Object.keys(current), ...Object.keys(edited)])];
  const changed = Object.fromEntries(
    names
      .filter((name) => !same(edited[name] ?? null, current[name] ?? null))
      .map((name) => [name, edited[name] ?? null]),
  );
  return Object.keys(changed).length === 0 ? undefined : changed;
};

/** What differs between the draft and the document, as a correction of the API. */
export const readCorrection = (
  draft: CorrectionDraft,
  current: DocumentView,
): CorrectionReading => {
  const core = readObject(draft.core, 'Core values');
  if (typeof core === 'string') return { ok: false, problem: core };
  const fields = readObject(draft.fields, 'Fields');
  if (typeof fields === 'string') return { ok: false, problem: fields };
  const type = draft.type.trim();
  const changedCore = changedValues(core, current.core);
  const changedFields = changedValues(fields, current.fields ?? {});
  const correction: DocumentCorrection = {
    ...(type !== '' && type !== current.type ? { type } : {}),
    ...(draft.private === current.private ? {} : { private: draft.private }),
    ...(changedCore === undefined ? {} : { core: changedCore }),
    ...(changedFields === undefined ? {} : { fields: changedFields }),
  };
  return Object.keys(correction).length === 0
    ? { ok: false, problem: 'Nothing differs from the values shown.' }
    : { ok: true, correction };
};
