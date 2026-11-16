import type { FieldDefinition } from '@liasse/contract/registry';
import type { DocumentCorrection, DocumentView } from '@liasse/sdk';
import {
  draftOfValue,
  editorOfDefinition,
  editorOfValue,
  readValueDraft,
  sameDraft,
  type ValueDraft,
  type ValueEditor,
} from './value-drafts.ts';

export type ValueSection = 'core' | 'fields';

/** One value of the form: where it lives, how it is edited and what it is now. */
export interface ValueRow {
  readonly key: string;
  readonly section: ValueSection;
  readonly name: string;
  readonly editor: ValueEditor;
  /** The value of the document; undefined for a field of the type it has no value for. */
  readonly current: unknown;
  readonly initial: ValueDraft;
  /** Corrected by hand: extraction keeps it over what it finds. */
  readonly manual: boolean;
}

/** The drafts the person edited, by row key; a row without one is unchanged. */
export type Drafts = Readonly<Record<string, ValueDraft>>;

type Values = Readonly<Record<string, unknown>>;
type Definitions = Readonly<Record<string, FieldDefinition>>;

const rowOf = (
  section: ValueSection,
  name: string,
  editor: ValueEditor,
  current: unknown,
  manual: ReadonlySet<string>,
): ValueRow => ({
  key: `${section}.${name}`,
  section,
  name,
  editor,
  current,
  initial: draftOfValue(editor, current),
  manual: manual.has(name),
});

const ownValue = (values: Values, name: string): unknown =>
  Object.hasOwn(values, name) ? values[name] : undefined;

/**
 * The rows of a document: its core values, then every field of its type and every field
 * it has a value for. The web UI is not given the definitions of the core: their editors
 * are guessed from the values.
 */
export const valueRowsOf = (
  document: DocumentView,
  definitions: Definitions | undefined,
): readonly ValueRow[] => {
  const manual: ReadonlySet<string> = new Set(document.manual_fields ?? []);
  const fields = document.fields ?? {};
  const known = definitions ?? {};
  const fieldNames = [...new Set([...Object.keys(known), ...Object.keys(fields)])];
  return [
    ...Object.entries(document.core).map(([name, value]) =>
      rowOf('core', name, editorOfValue(value), value, manual),
    ),
    ...fieldNames.map((name) => {
      const value = ownValue(fields, name);
      const definition = Object.hasOwn(known, name) ? known[name] : undefined;
      const editor =
        definition === undefined ? editorOfValue(value) : editorOfDefinition(definition);
      return rowOf('fields', name, editor, value, manual);
    }),
  ];
};

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** The rows whose draft differs from what the document has. */
export const changedRows = (rows: readonly ValueRow[], drafts: Drafts): readonly ValueRow[] =>
  rows.filter((row) => {
    const draft = Object.hasOwn(drafts, row.key) ? drafts[row.key] : undefined;
    return draft !== undefined && !sameDraft(draft, row.initial);
  });

export type CorrectionReading =
  | { readonly ok: true; readonly correction: DocumentCorrection }
  | { readonly ok: false; readonly problems: readonly string[] };

interface Change {
  readonly row: ValueRow;
  readonly value: unknown;
}

const valuesOf = (changes: readonly Change[], section: ValueSection): Values | undefined => {
  const values = changes.filter(({ row }) => row.section === section);
  return values.length === 0
    ? undefined
    : Object.fromEntries(values.map(({ row, value }) => [row.name, value]));
};

/**
 * What the drafts change in the document, as a correction of the API. Only the values the
 * person changed: one sent unchanged would be marked as corrected by hand, and a masked
 * identifier sent back would replace the real one. A cleared value is sent as null.
 */
export const readCorrection = (rows: readonly ValueRow[], drafts: Drafts): CorrectionReading => {
  const readings = changedRows(rows, drafts).map((row) => ({
    row,
    reading: readValueDraft(row.editor, drafts[row.key] ?? row.initial),
  }));
  const problems = readings.flatMap(({ row, reading }) =>
    reading.ok ? [] : [`${row.name}: ${reading.error}`],
  );
  if (problems.length > 0) return { ok: false, problems };
  const changes = readings.flatMap(({ row, reading }) =>
    reading.ok && !same(reading.value, row.current ?? null) ? [{ row, value: reading.value }] : [],
  );
  const core = valuesOf(changes, 'core');
  const fields = valuesOf(changes, 'fields');
  return changes.length === 0
    ? { ok: false, problems: ['Nothing differs from the values shown.'] }
    : {
        ok: true,
        correction: {
          ...(core === undefined ? {} : { core }),
          ...(fields === undefined ? {} : { fields }),
        },
      };
};
