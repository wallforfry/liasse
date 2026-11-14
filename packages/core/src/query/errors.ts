import { MAX_QUERY_ECHOED_LENGTH, MAX_QUERY_REPORTED_PROBLEMS } from '../domain/limits.ts';

// Where in the query the problem is, as the keys and indexes that lead to it:
// `['where', 2, 0]` is the field path of the third condition.
export type QueryLocation = readonly (string | number)[];

interface Failure<Code extends string> {
  readonly code: Code;
  // Written by Liasse alone. Text that comes from the query is quoted and cut in it.
  // Free text that comes from documents or from the registry (enum values, entity
  // names) is never part of it and travels, cut, in a field of its own; a field path is
  // spelled, since the naming rules of the registry hold it to a short snake_case name.
  // It never carries SQL, a column name or any other detail of the storage.
  readonly message: string;
  readonly path: QueryLocation;
}

export interface AvailableField {
  readonly path: string;
  readonly primitive: string;
}

export interface UnknownField extends Failure<'unknown_field'> {
  readonly field: string;
  readonly suggestion?: string;
  // Closest names first, so that a truncated listing keeps the likely ones.
  readonly available: readonly AvailableField[];
  readonly truncated: boolean;
}

export interface NotAllowed<Code extends string> extends Failure<Code> {
  readonly allowed: readonly string[];
}

export interface InvalidLiteral extends Failure<'invalid_literal'> {
  // The values an enum takes. They come from the registry: untrusted content, cut.
  readonly allowed?: readonly string[];
}

// The last entry of a list that was cut: how many entries are not in it.
export interface LeftOut<Code extends string> extends Failure<Code> {
  readonly omitted: number;
}

export type QueryError =
  | Failure<'invalid_query'>
  | Failure<'unknown_type'>
  | UnknownField
  | NotAllowed<'unsupported_operator'>
  | NotAllowed<'unsupported_aggregate'>
  | InvalidLiteral
  | Failure<'not_sortable'>
  | Failure<'not_groupable'>
  | Failure<'too_many_entities'>
  | Failure<'timeout'>
  | LeftOut<'more_errors'>;

export type QueryErrorCode = QueryError['code'];

export interface UnknownEntity extends Failure<'unknown_entity'> {
  readonly name: string;
  // Canonical names of close entities. They come from documents: untrusted content, cut.
  readonly suggestions: readonly string[];
}

export type QueryWarning =
  | Failure<'implicit_currency_grouping'>
  | Failure<'order_by_ignored'>
  | UnknownEntity
  | LeftOut<'more_warnings'>;

// Text that is not ours is cut wherever it is echoed, so an answer stays small whatever
// a query, a document or the registry holds.
export const cut = (text: string): string =>
  text.length > MAX_QUERY_ECHOED_LENGTH ? `${text.slice(0, MAX_QUERY_ECHOED_LENGTH)}...` : text;

export const quoted = (value: unknown): string =>
  JSON.stringify(cut(typeof value === 'string' ? value : JSON.stringify(value ?? null)));

export const failure = <Code extends string>(
  code: Code,
  path: QueryLocation,
  message: string,
): Failure<Code> => ({ code, message, path });

export const notAllowed = <Code extends string>(
  code: Code,
  path: QueryLocation,
  message: string,
  allowed: readonly string[],
): NotAllowed<Code> => ({ code, message, path, allowed });

const capped = <Problem, Code extends string>(
  problems: readonly Problem[],
  code: Code,
  noun: string,
): readonly (Problem | LeftOut<Code>)[] => {
  const omitted = problems.length - MAX_QUERY_REPORTED_PROBLEMS;
  return omitted <= 0
    ? problems
    : [
        ...problems.slice(0, MAX_QUERY_REPORTED_PROBLEMS),
        {
          code,
          path: [],
          omitted,
          message: `${String(omitted)} more ${noun}${omitted === 1 ? ' was' : 's were'} left out.`,
        },
      ];
};

export const cappedErrors = (errors: readonly QueryError[]): readonly QueryError[] =>
  capped(errors, 'more_errors', 'error');

export const cappedWarnings = (warnings: readonly QueryWarning[]): readonly QueryWarning[] =>
  capped(warnings, 'more_warnings', 'warning');
