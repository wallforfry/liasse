import { err, ok, type Result } from '../registry/result.ts';

type Checked<Value, Failure> = Result<Value, readonly Failure[]>;

// Every failure of every part, so one answer is enough to fix a query.
export const collect = <Value, Failure>(
  results: readonly Checked<Value, Failure>[],
): Checked<readonly Value[], Failure> => {
  const failures = results.flatMap((result) => (result.ok ? [] : result.error));
  return failures.length > 0
    ? err(failures)
    : ok(results.flatMap((result) => (result.ok ? [result.value] : [])));
};
