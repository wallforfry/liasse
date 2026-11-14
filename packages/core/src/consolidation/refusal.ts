import type { Result } from '../registry/result.ts';

/**
 * A change the registry, the entities or the subjects refuse as they are now: thrown
 * inside the savepoint of the change so that what it moved is undone, then recorded as
 * the reason the change was rejected.
 */
export class ChangeRefusedError extends Error {
  override readonly name = 'ChangeRefusedError';
  readonly code: string;

  constructor({ code, message }: { readonly code: string; readonly message: string }) {
    super(message);
    this.code = code;
  }
}

/** The value of a result, or the refusal of the change. */
export const orRefuse = <Value>(
  result: Result<Value, { code: string; message: string }>,
): Value => {
  if (!result.ok) throw new ChangeRefusedError(result.error);
  return result.value;
};
