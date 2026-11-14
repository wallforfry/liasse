// Runs `task` over `items` with at most `limit` running at once and returns the results in
// the order of the items. After a failure no new task starts; the ones already running are
// awaited, so the caller can release what they use, and the first failure is rethrown.
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<readonly R[]> => {
  const results: R[] = [];
  const failures: unknown[] = [];
  // One iterator shared by every worker: each entry is handed out exactly once.
  const pending = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of pending) {
      if (failures.length > 0) return;
      try {
        results[index] = await task(item, index);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  if (failures.length > 0) throw failures[0];
  return results;
};
