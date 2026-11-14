// Where in the query the problem is, as the keys and indexes that lead to it:
// `['where', 2, 0]` is the field path of the third condition.
export type QueryLocation = readonly (string | number)[];

interface Failure<Code extends string> {
  readonly code: Code;
  // Complete on its own: it is shown as is to the agent that sent the query. It never
  // carries SQL, a column name or any other detail of the storage.
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

export type QueryError =
  | Failure<'invalid_query'>
  | Failure<'unknown_type'>
  | UnknownField
  | NotAllowed<'unsupported_operator'>
  | NotAllowed<'unsupported_aggregate'>
  | Failure<'invalid_literal'>
  | Failure<'not_sortable'>
  | Failure<'not_groupable'>
  | Failure<'timeout'>;

export type QueryErrorCode = QueryError['code'];

export interface QueryWarning {
  readonly code: 'unknown_entity' | 'implicit_currency_grouping' | 'order_by_ignored';
  readonly message: string;
  readonly path: QueryLocation;
}

const MAX_QUOTED_LENGTH = 60;

// User text echoed in a message is cut, so a message stays small whatever was sent.
export const quoted = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return JSON.stringify(
    text.length > MAX_QUOTED_LENGTH ? `${text.slice(0, MAX_QUOTED_LENGTH)}...` : text,
  );
};

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
