// Field names come from models and agents, and `constructor` is a valid snake_case name.
// Indexing a record with it answers the inherited member of every object, so each lookup
// by field name goes through here.
export const ownValue = <Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Value | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

// Zod's record schema silently leaves out a key named `__proto__`, so a record whose keys
// all have to be seen is read with this guard and `Object.entries` instead.
export const isPlainRecord = (input: unknown): input is Readonly<Record<string, unknown>> => {
  if (typeof input !== 'object' || input === null) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
};

// Zod reads a declared key with `input[key]`, inherited members included: a document
// without a `constructor` field would otherwise be validated against `Object`.
export const ownProperties = (input: unknown): unknown =>
  isPlainRecord(input) ? Object.assign(Object.create(null), input) : input;
