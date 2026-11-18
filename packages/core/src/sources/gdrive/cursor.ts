import { z } from 'zod';
import type { JsonObject } from '../../db/columns.ts';

/**
 * Where a Drive source is. `page_token` is where the next listing of changes starts, taken
 * before the first listing of the folder so that nothing changed meanwhile is missed.
 * `folders` is the tree read, each folder with its parent (the root with none), which is
 * how a change is known to be inside it. `pending` are folders still to list, the first
 * one from `listing` when a page of it was read. `shortcuts` maps each shortcut followed
 * to its target, which is read as if it were inside the tree.
 */
export const driveCursorSchema = z.object({
  folder_id: z.string(),
  root: z.string(),
  page_token: z.string(),
  folders: z.record(z.string(), z.string().nullable()),
  pending: z.array(z.string()),
  listing: z.string().nullable(),
  shortcuts: z.record(z.string(), z.string()),
});
export type DriveCursor = z.output<typeof driveCursorSchema>;

/** The stored cursor, or undefined to start over: none, or one of another shape. */
export const parseDriveCursor = (cursor: JsonObject | null): DriveCursor | undefined => {
  const parsed = driveCursorSchema.safeParse(cursor);
  return parsed.success ? parsed.data : undefined;
};

/** A folder and every folder under it, by the parents the cursor knows. */
export const subtreeOf = (folders: DriveCursor['folders'], id: string): ReadonlySet<string> => {
  const grow = (known: ReadonlySet<string>): ReadonlySet<string> => {
    const next = new Set([
      ...known,
      ...Object.entries(folders)
        .filter(([, parent]) => parent !== null && known.has(parent))
        .map(([child]) => child),
    ]);
    return next.size === known.size ? known : grow(next);
  };
  return grow(new Set([id]));
};

export const withoutFolders = (cursor: DriveCursor, removed: ReadonlySet<string>): DriveCursor => ({
  ...cursor,
  folders: Object.fromEntries(Object.entries(cursor.folders).filter(([id]) => !removed.has(id))),
  pending: cursor.pending.filter((id) => !removed.has(id)),
  listing:
    cursor.pending[0] !== undefined && removed.has(cursor.pending[0]) ? null : cursor.listing,
});

export const withShortcut = (
  cursor: DriveCursor,
  shortcut: string,
  target: string | undefined,
): DriveCursor => {
  const { [shortcut]: _previous, ...others } = cursor.shortcuts;
  return {
    ...cursor,
    shortcuts: target === undefined ? others : { ...others, [shortcut]: target },
  };
};

/** Whether a file is the target of a shortcut followed, so read as if inside the tree. */
export const isShortcutTarget = (cursor: DriveCursor, id: string): boolean =>
  Object.values(cursor.shortcuts).includes(id);
