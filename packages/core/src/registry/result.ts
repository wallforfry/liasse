export type Result<Value, Failure> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Failure };

export const ok = <Value>(value: Value): { readonly ok: true; readonly value: Value } => ({
  ok: true,
  value,
});

export const err = <Failure>(error: Failure): { readonly ok: false; readonly error: Failure } => ({
  ok: false,
  error,
});
