import { isPlainRecord } from '../registry/own.ts';
import type { QueryLocation } from './errors.ts';

const NUL = '\u0000';

// A place in the query, as the key that leads to it from its parent.
interface Visit {
  readonly value: unknown;
  readonly key: string | number;
  readonly parent: Visit | undefined;
}

const entriesOf = (value: unknown): readonly (readonly [string | number, unknown])[] => {
  if (Array.isArray(value)) return value.map((item: unknown, index) => [index, item] as const);
  return isPlainRecord(value) ? Object.entries(value) : [];
};

const pathOf = (visit: Visit): QueryLocation => {
  const keys: (string | number)[] = [];
  for (let place = visit; place.parent !== undefined; place = place.parent) {
    keys.push(place.key);
  }
  return keys.toReversed();
};

/**
 * The places of a query whose text holds a NUL character, in document order. Postgres
 * cannot hold one in a text parameter and fails the whole statement instead. The value
 * of a condition is any JSON of any depth: it is walked with a stack, not by recursion,
 * and a path is only built for a place that is reported.
 */
export const nulCharacterPlaces = (input: unknown): readonly QueryLocation[] => {
  const places: QueryLocation[] = [];
  const pending: Visit[] = [{ value: input, key: '', parent: undefined }];
  for (let visit = pending.pop(); visit !== undefined; visit = pending.pop()) {
    if (typeof visit.value === 'string' && visit.value.includes(NUL)) places.push(pathOf(visit));
    const entries = entriesOf(visit.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, value] = entries[index] ?? ['', undefined];
      pending.push({ value, key, parent: visit });
    }
  }
  return places;
};
