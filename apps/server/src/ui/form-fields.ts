/**
 * The fields of a form or a query string that hold something: a field left empty, or a
 * select left on "Any", means the option is not given.
 */
export const filledFields = <Value>(
  fields: Readonly<Record<string, Value>>,
): Record<string, Value> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''));
