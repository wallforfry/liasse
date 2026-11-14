import type { TypeFields } from '../registry/fields.ts';
import { ownValue } from '../registry/own.ts';
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

interface Entry {
  readonly name: string;
  readonly value: unknown;
  readonly destination: string;
}

const fits = (fields: TypeFields, name: string, value: unknown): boolean => {
  const definition = ownValue(fields, name);
  return (
    definition !== undefined &&
    validateDocumentFields({ fields: { [name]: definition } }, { [name]: value }).ok
  );
};

const renameIn = (record: Values, from: string, to: string): Values => {
  const value = ownValue(record, from);
  if (value === undefined || from === to) return record;
  return {
    ...Object.fromEntries(Object.entries(record).filter(([name]) => name !== from)),
    [to]: value,
  };
};

/**
 * Moves the values of a document to the schema a change gives its type. A value becomes
 * the field it is renamed to (or keeps its name) when the schema has that field and the
 * value fits its definition; any other value goes to `extra` under the name it had, so
 * nothing is lost. Provenance and the manual mark follow the value: a value a person
 * corrected stays protected under its new name, and no extraction writes it again.
 *
 * Two values for one field: a value that is already a field wins over one from `extra`,
 * and the first one met otherwise; the other stays in `extra`.
 */
export const rehomeValues = (document: DocumentValues, { fields, renames }: Rehoming) => {
  const entries: readonly Entry[] = [
    ...Object.entries(document.fields),
    ...Object.entries(document.extra),
  ].map(([name, value]) => ({ name, value, destination: renames.get(name) ?? name }));
  const placed = entries.reduce<readonly Entry[]>(
    (taken, entry) =>
      fits(fields, entry.destination, entry.value) &&
      !taken.some(({ destination }) => destination === entry.destination)
        ? [...taken, entry]
        : taken,
    [],
  );
  const isPlaced = (entry: Entry) => placed.includes(entry);
  const moved = placed.filter(({ name, destination }) => name !== destination);
  return {
    fields: Object.fromEntries(placed.map(({ destination, value }) => [destination, value])),
    extra: Object.fromEntries(
      entries.filter((entry) => !isPlaced(entry)).map(({ name, value }) => [name, value]),
    ),
    provenance: moved.reduce(
      (provenance, { name, destination }) => renameIn(provenance, name, destination),
      document.provenance,
    ),
    manualFields: document.manualFields.map(
      (name) => moved.find((entry) => entry.name === name)?.destination ?? name,
    ),
  };
};
