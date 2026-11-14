import { MAX_QUERY_LISTED_FIELDS } from '../domain/limits.ts';
import { err, ok, type Result } from '../registry/result.ts';
import { editDistance, isClose, rankByDistance } from './closest.ts';
import { type QueryError, type QueryLocation, quoted, type UnknownField } from './errors.ts';
import type { QueryField } from './fields.ts';

const TYPE_FIELDS_PREFIX = 'fields.';

const withoutNamespace = (path: string): string => path.slice(path.indexOf('.') + 1);

// `amount` is as close to `core.amount` as a typo is: the namespace is often forgotten.
const distanceTo =
  (target: string) =>
  ({ path }: QueryField): number =>
    Math.min(editDistance(target, path), editDistance(target, withoutNamespace(path)));

const typeHint = (target: string, fields: readonly QueryField[]): string =>
  target.startsWith(TYPE_FIELDS_PREFIX) &&
  !fields.some(({ path }) => path.startsWith(TYPE_FIELDS_PREFIX))
    ? ' No type field exists here: give a "type" that defines it.'
    : '';

const unknownField = (
  target: string,
  fields: readonly QueryField[],
  at: QueryLocation,
): UnknownField => {
  const ranked = rankByDistance(fields, distanceTo(target));
  const [closest] = ranked;
  const suggestion =
    closest !== undefined && isClose(closest.distance, target) ? closest.item.path : undefined;
  const available = ranked
    .slice(0, MAX_QUERY_LISTED_FIELDS)
    .map(({ item }) => ({ path: item.path, primitive: item.primitive }));
  const hidden = ranked.length - available.length;
  const listing = available.map(({ path, primitive }) => `${path} (${primitive})`).join(', ');
  return {
    code: 'unknown_field',
    message: `Unknown field ${quoted(target)}.${suggestion === undefined ? '' : ` Did you mean "${suggestion}"?`}${typeHint(target, fields)} Available fields, closest first: ${listing}${hidden > 0 ? `, and ${String(hidden)} more` : ''}.`,
    path: at,
    field: target,
    ...(suggestion === undefined ? {} : { suggestion }),
    available,
    truncated: hidden > 0,
  };
};

export const findField = (
  fields: readonly QueryField[],
  path: string,
  at: QueryLocation,
): Result<QueryField, readonly QueryError[]> => {
  const field = fields.find((candidate) => candidate.path === path);
  return field === undefined ? err([unknownField(path, fields, at)]) : ok(field);
};

export const partsHint = ({ path, parts }: QueryField): string =>
  parts.length === 0 ? '' : ` Address ${parts.map((part) => `${path}.${part}`).join(' or ')}.`;
