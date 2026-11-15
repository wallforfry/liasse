import {
  type DocumentCorrection,
  documentCorrectionSchema,
  type DocumentView,
} from '@liasse/contract';
import { z } from 'zod';

export type FormBody = Readonly<Record<string, string | File | (string | File)[]>>;

export type CorrectionReading =
  | { readonly ok: true; readonly correction: DocumentCorrection }
  | { readonly ok: false; readonly problem: string };

type Values = Readonly<Record<string, unknown>>;

const jsonObject = z.record(z.string(), z.unknown());

const textOf = (body: FormBody, name: string): string => {
  const value = body[name];
  return typeof value === 'string' ? value : '';
};

const readObject = (text: string, label: string): Values | string => {
  if (text.trim() === '') return {};
  try {
    const parsed = jsonObject.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : `${label} must be a JSON object.`;
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

/** Reads the correction form of a document into what differs from the document. */
export const readCorrection = (body: FormBody, current: DocumentView): CorrectionReading => {
  const core = readObject(textOf(body, 'core'), 'Core values');
  if (typeof core === 'string') return { ok: false, problem: core };
  const fields = readObject(textOf(body, 'fields'), 'Fields');
  if (typeof fields === 'string') return { ok: false, problem: fields };
  const type = textOf(body, 'type').trim();
  const isPrivate = textOf(body, 'private') === 'true';
  const changedCore = changedValues(core, current.core);
  const changedFields = changedValues(fields, current.fields ?? {});
  const correction = documentCorrectionSchema.parse({
    ...(type !== '' && type !== current.type ? { type } : {}),
    ...(isPrivate === current.private ? {} : { private: isPrivate }),
    ...(changedCore === undefined ? {} : { core: changedCore }),
    ...(changedFields === undefined ? {} : { fields: changedFields }),
  });
  return Object.keys(correction).length === 0
    ? { ok: false, problem: 'Nothing differs from the values shown.' }
    : { ok: true, correction };
};
