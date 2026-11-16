import { isoDateSchema, moneySchema, periodSchema } from '@liasse/contract/domain';
import { err, type FieldDefinition, ok, type Result } from '@liasse/contract/registry';
import type { z } from 'zod';

/** The input a value is edited with. */
export type ValueEditor =
  | { readonly kind: 'text' | 'number' | 'date' | 'boolean' | 'money' | 'period' | 'json' }
  | { readonly kind: 'enum'; readonly values: readonly string[] };

/** What the inputs of one value hold, as typed. An empty draft clears the value. */
export type ValueDraft =
  | { readonly kind: 'single'; readonly text: string }
  | { readonly kind: 'money'; readonly amount: string; readonly currency: string }
  | { readonly kind: 'period'; readonly start: string; readonly end: string };

/** The value a draft stands for, null for a cleared one, or why it is not one. */
export type ValueReading = Result<unknown, string>;

/** The editor of a field primitive. A list has no simple input: it is edited as JSON. */
export const editorOfDefinition = (definition: FieldDefinition): ValueEditor => {
  switch (definition.type) {
    case 'text':
    case 'entity':
    case 'identifier':
      return { kind: 'text' };
    case 'number':
    case 'date':
    case 'boolean':
    case 'money':
    case 'period':
      return { kind: definition.type };
    case 'enum':
      return { kind: 'enum', values: definition.values };
    case 'list':
      return { kind: 'json' };
  }
};

/** The editor of a value no definition describes, guessed from its shape. */
export const editorOfValue = (value: unknown): ValueEditor => {
  if (typeof value === 'string') {
    return { kind: isoDateSchema.safeParse(value).success ? 'date' : 'text' };
  }
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (moneySchema.safeParse(value).success) return { kind: 'money' };
  if (periodSchema.safeParse(value).success) return { kind: 'period' };
  return { kind: 'json' };
};

export const emptyDraft = (editor: ValueEditor): ValueDraft => {
  if (editor.kind === 'money') return { kind: 'money', amount: '', currency: '' };
  if (editor.kind === 'period') return { kind: 'period', start: '', end: '' };
  return { kind: 'single', text: '' };
};

const textOf = (editor: ValueEditor, value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (editor.kind === 'json') return JSON.stringify(value, null, 2);
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/** The inputs of a value as it is now. A value its editor cannot show leaves them empty. */
export const draftOfValue = (editor: ValueEditor, value: unknown): ValueDraft => {
  if (editor.kind === 'money') {
    const money = moneySchema.safeParse(value);
    return money.success
      ? { kind: 'money', amount: String(money.data.value), currency: money.data.currency }
      : emptyDraft(editor);
  }
  if (editor.kind === 'period') {
    const period = periodSchema.safeParse(value);
    return period.success ? { kind: 'period', ...period.data } : emptyDraft(editor);
  }
  return { kind: 'single', text: textOf(editor, value) };
};

const parsed = (schema: z.ZodType, value: unknown): ValueReading => {
  const result = schema.safeParse(value);
  return result.success ? ok(result.data) : err(result.error.issues[0]?.message ?? 'invalid');
};

// `Number('')` is 0: an empty amount must stay an error, never a zero.
const numberOf = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

const readJson = (text: string): ValueReading => {
  try {
    return ok(JSON.parse(text));
  } catch {
    return err('expected valid JSON');
  }
};

const readText = (editor: ValueEditor, text: string): ValueReading => {
  switch (editor.kind) {
    case 'number':
      return Number.isFinite(numberOf(text)) ? ok(numberOf(text)) : err('expected a number');
    case 'date':
      return parsed(isoDateSchema, text);
    case 'boolean':
      return text === 'true' || text === 'false' ? ok(text === 'true') : err('expected yes or no');
    case 'json':
      return readJson(text);
    case 'enum':
      return editor.values.includes(text) ? ok(text) : err('expected one of the listed values');
    case 'text':
    case 'money':
    case 'period':
      return ok(text);
  }
};

/** The value a draft stands for. Empty inputs clear the value: they read as null. */
export const readValueDraft = (editor: ValueEditor, draft: ValueDraft): ValueReading => {
  switch (draft.kind) {
    case 'money':
      return draft.amount.trim() === '' && draft.currency.trim() === ''
        ? ok(null)
        : parsed(moneySchema, {
            value: numberOf(draft.amount),
            currency: draft.currency.trim().toUpperCase(),
          });
    case 'period':
      return draft.start === '' && draft.end === ''
        ? ok(null)
        : parsed(periodSchema, { start: draft.start, end: draft.end });
    case 'single':
      return draft.text.trim() === '' ? ok(null) : readText(editor, draft.text.trim());
  }
};

export const isEmptyDraft = (draft: ValueDraft): boolean => {
  switch (draft.kind) {
    case 'money':
      return draft.amount === '' && draft.currency === '';
    case 'period':
      return draft.start === '' && draft.end === '';
    case 'single':
      return draft.text === '';
  }
};

export const sameDraft = (left: ValueDraft, right: ValueDraft): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
