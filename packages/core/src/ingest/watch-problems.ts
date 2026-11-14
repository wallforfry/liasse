export type WatchErrorListener = (error: unknown, path: string | undefined) => void;

export interface WatchProblems {
  /** Reports a standing problem the first time it is seen under this key. */
  readonly raise: (key: string, error: unknown, path: string | undefined) => void;
  /** Forgets every problem of the group that is not among the keys still standing. */
  readonly keepOnly: (group: string, standing: readonly string[]) => void;
}

/**
 * A scan runs every few seconds. A condition that lasts (a directory that cannot be
 * read, a folder that does not exist yet, a file system without events) is reported
 * when it appears and again only after it went away and came back.
 */
export const createWatchProblems = (onError: WatchErrorListener): WatchProblems => {
  const reported = new Set<string>();
  return {
    raise: (key, error, path) => {
      if (reported.has(key)) return;
      reported.add(key);
      onError(error, path);
    },
    keepOnly: (group, standing) => {
      const kept = new Set(standing);
      [...reported]
        .filter((key) => key.startsWith(group) && !kept.has(key))
        .forEach((key) => reported.delete(key));
    },
  };
};
