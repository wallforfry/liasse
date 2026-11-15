import { err, ok, ownValue, type Result } from '@liasse/contract/registry';
import type { TypeFields } from '../registry/fields.ts';
import { validateDocumentFields } from '../registry/validate-document-fields.ts';

type Values = Readonly<Record<string, unknown>>;

/** What a change of schema moves of one document; its core is never touched. */
export interface DocumentValues {
  readonly fields: Values;
  readonly extra: Values;
  readonly provenance: Values;
  readonly manualFields: readonly string[];
}

export interface Rehoming {
  /** The fields of the type the document has once the change is applied. */
  readonly fields: TypeFields;
  /** The name each value of `fields` or `extra` takes; a value not named keeps its own. */
  readonly renames: ReadonlyMap<string, string>;
}

export interface RehomedValues {
  readonly fields: Values;
  readonly extra: Values;
  readonly provenance: Values;
  readonly manualFields: readonly string[];
}

/** Values a person corrected that the change would leave with no key of their own. */
export interface ManualCollision {
  readonly manual: readonly string[];
}

interface Entry {
  /** The name the value has before the change: its provenance and mark are under it. */
  readonly name: string;
  readonly value: unknown;
  readonly manual: boolean;
  /** The field it becomes, when the new schema has that field and the value fits it. */
  readonly field: string | undefined;
}

type Placement =
  | { readonly entry: Entry; readonly section: 'fields' | 'extra'; readonly key: string }
  | { readonly entry: Entry; readonly section: 'dropped' };

const fits = (fields: TypeFields, name: string, value: unknown): boolean => {
  const definition = ownValue(fields, name);
  return (
    definition !== undefined &&
    validateDocumentFields({ fields: { [name]: definition } }, { [name]: value }).ok
  );
};

// Manual values first. Within each standing, a value that fits no field comes before one
// that does, so it keeps its own name and no renamed value lands on it; then a value that
// is already a field comes before one of `extra`.
const rank = ({ manual, field }: Entry, fromFields: boolean): number =>
  (manual ? 0 : 4) + (field === undefined ? 0 : 2) + (fromFields ? 0 : 1);

const place = (entries: readonly Entry[], reserved: ReadonlySet<string>): readonly Placement[] =>
  entries.reduce<{ readonly taken: ReadonlySet<string>; readonly placed: readonly Placement[] }>(
    ({ taken, placed }, entry) => {
      const free = (key: string) => !taken.has(key);
      const placement: Placement =
        entry.field !== undefined && free(entry.field)
          ? { entry, section: 'fields', key: entry.field }
          : free(entry.name)
            ? { entry, section: 'extra', key: entry.name }
            : { entry, section: 'dropped' };
      return {
        taken: placement.section === 'dropped' ? taken : new Set([...taken, placement.key]),
        placed: [...placed, placement],
      };
    },
    { taken: reserved, placed: [] },
  ).placed;

const sectionOf = (placements: readonly Placement[], section: 'fields' | 'extra'): Values =>
  Object.fromEntries(
    placements.flatMap((placement) =>
      placement.section === section ? [[placement.key, placement.entry.value] as const] : [],
    ),
  );

/**
 * Moves the values of a document to the schema a change gives its type, in one pass from
 * the name each value had: a value becomes the field it is renamed to (or keeps its name)
 * when the schema has that field and the value fits it, and goes to `extra` under its own
 * name otherwise. Its provenance entry and its manual mark go with it, under the key it
 * ends at; no key is both a field and a key of `extra`.
 *
 * On a collision a value a person corrected wins, and a mark of a field a person cleared
 * keeps its name free. An extracted value that loses its own name to a manual one is
 * dropped: the correction stands for it, and the re-extraction can give it back. Two
 * corrected values that would leave one of them nowhere are a `ManualCollision`: no value
 * a person corrected is ever dropped.
 */
export const rehomeValues = (
  document: DocumentValues,
  { fields, renames }: Rehoming,
): Result<RehomedValues, ManualCollision> => {
  const isManual = (name: string) => document.manualFields.includes(name);
  const entryOf = ([name, value]: readonly [string, unknown]): Entry => {
    const destination = renames.get(name) ?? name;
    return {
      name,
      value,
      manual: isManual(name),
      field: fits(fields, destination, value) ? destination : undefined,
    };
  };
  const ranked = [
    ...Object.entries(document.fields).map((pair) => ({ entry: entryOf(pair), fromFields: true })),
    ...Object.entries(document.extra).map((pair) => ({ entry: entryOf(pair), fromFields: false })),
  ]
    .toSorted((a, b) => rank(a.entry, a.fromFields) - rank(b.entry, b.fromFields))
    .map(({ entry }) => entry);
  const valueNames = new Set(ranked.map(({ name }) => name));
  const cleared = new Set(document.manualFields.filter((name) => !valueNames.has(name)));
  const placements = place(ranked, cleared);
  const lost = placements.flatMap((placement) =>
    placement.section === 'dropped' && placement.entry.manual ? [placement.entry.name] : [],
  );
  if (lost.length > 0) return err({ manual: lost });
  const keyOf = new Map(
    placements.flatMap((placement) =>
      placement.section === 'dropped' ? [] : [[placement.entry.name, placement.key] as const],
    ),
  );
  return ok({
    fields: sectionOf(placements, 'fields'),
    extra: sectionOf(placements, 'extra'),
    provenance: {
      ...Object.fromEntries(
        Object.entries(document.provenance).filter(([name]) => !valueNames.has(name)),
      ),
      ...Object.fromEntries(
        [...keyOf].flatMap(([name, key]) => {
          const entry = ownValue(document.provenance, name);
          return entry === undefined ? [] : [[key, entry] as const];
        }),
      ),
    },
    manualFields: document.manualFields.flatMap((name) => {
      if (!valueNames.has(name)) return [name];
      const key = keyOf.get(name);
      return key === undefined ? [] : [key];
    }),
  });
};
