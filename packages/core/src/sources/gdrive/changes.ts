import type { GdriveSourceConfig } from '@liasse/contract';
import type { SourceChange } from '../connector.ts';
import {
  type DriveCursor,
  isShortcutTarget,
  subtreeOf,
  withoutFolders,
  withShortcut,
} from './cursor.ts';
import type { DriveApi, DriveChange, DriveFile } from './drive-api.ts';
import { FOLDER_TYPE, fileItem, SHORTCUT_TYPE } from './items.ts';

export interface DriveWalk {
  readonly api: DriveApi;
  readonly config: GdriveSourceConfig;
  readonly signal: AbortSignal;
}

/** Each step yields the changes it found and returns the cursor after it. */
type Step = AsyncGenerator<SourceChange, DriveCursor>;

const startCursor = async ({ api, config, signal }: DriveWalk): Promise<DriveCursor> => {
  const root = await api.file(config.folder_id, signal);
  if (root?.mimeType !== FOLDER_TYPE || root.trashed === true) {
    throw new Error(`Drive has no folder ${config.folder_id} this account can read.`);
  }
  // Taken before the folder is listed: what changes during the listing comes after it.
  const pageToken = await api.startPageToken(signal);
  return {
    folder_id: config.folder_id,
    root: root.id,
    page_token: pageToken,
    folders: { [root.id]: null },
    pending: [root.id],
    listing: null,
    shortcuts: {},
  };
};

const inTree = (cursor: DriveCursor, file: DriveFile): boolean =>
  file.trashed !== true &&
  (file.id === cursor.root ||
    (file.parents ?? []).some((parent) => Object.hasOwn(cursor.folders, parent)));

// A shortcut no longer followed: its target is removed unless something else reaches it.
async function* targetDropped(walk: DriveWalk, cursor: DriveCursor, target: string): Step {
  if (isShortcutTarget(cursor, target)) return cursor;
  const file = await walk.api.file(target, walk.signal);
  if (file !== undefined && inTree(cursor, file)) return cursor;
  yield { cursor, removed: target };
  return cursor;
}

// Followed once: the target of a shortcut is read as a file of the tree, never as a folder
// to walk nor as a shortcut to follow in turn.
async function* followShortcut(walk: DriveWalk, cursor: DriveCursor, shortcut: DriveFile): Step {
  const previous = cursor.shortcuts[shortcut.id];
  const targetId = shortcut.shortcutDetails?.targetId;
  const target = targetId === undefined ? undefined : await walk.api.file(targetId, walk.signal);
  const followed =
    target !== undefined &&
    target.trashed !== true &&
    target.mimeType !== FOLDER_TYPE &&
    target.mimeType !== SHORTCUT_TYPE;
  const next = withShortcut(cursor, shortcut.id, followed ? target.id : undefined);
  if (previous !== undefined && previous !== next.shortcuts[shortcut.id]) {
    yield* targetDropped(walk, next, previous);
  }
  const item = followed ? fileItem(walk.api, target) : undefined;
  yield item === undefined ? { cursor: next } : { cursor: next, item };
  return next;
}

// A file inside the tree, as a listing or a change gives it.
async function* visit(walk: DriveWalk, cursor: DriveCursor, file: DriveFile): Step {
  if (file.mimeType === FOLDER_TYPE) {
    if (Object.hasOwn(cursor.folders, file.id)) {
      if (file.id === cursor.root) return cursor;
      const moved = {
        ...cursor,
        folders: { ...cursor.folders, [file.id]: file.parents?.[0] ?? null },
      };
      yield { cursor: moved };
      return moved;
    }
    const entered = {
      ...cursor,
      folders: { ...cursor.folders, [file.id]: file.parents?.[0] ?? null },
      pending: [...cursor.pending, file.id],
    };
    yield { cursor: entered };
    return entered;
  }
  if (file.mimeType === SHORTCUT_TYPE) return yield* followShortcut(walk, cursor, file);
  const item = fileItem(walk.api, file);
  yield item === undefined ? { cursor } : { cursor, item };
  return cursor;
}

// Lists the folders still pending, page by page. A page read again after a stop hands
// back items already taken, which the hash dedup absorbs.
async function* listPending(walk: DriveWalk, start: DriveCursor): Step {
  let cursor = start;
  for (let folder = cursor.pending[0]; folder !== undefined; folder = cursor.pending[0]) {
    const page = await walk.api.children(
      folder,
      { pageToken: cursor.listing ?? undefined, withTrashed: false },
      walk.signal,
    );
    for (const file of page.entries) cursor = yield* visit(walk, cursor, file);
    cursor =
      page.nextPageToken === undefined
        ? { ...cursor, pending: cursor.pending.slice(1), listing: null }
        : { ...cursor, listing: page.nextPageToken };
    yield { cursor };
  }
  return cursor;
}

// A folder trashed, deleted or moved out: the files under it are removed. A deleted
// folder cannot be listed, but Drive reports the deletion of each file it held.
async function* folderLeft(
  walk: DriveWalk,
  cursor: DriveCursor,
  id: string,
  listable: boolean,
): Step {
  const gone = subtreeOf(cursor.folders, id);
  let next = cursor;
  for (const folder of listable ? gone : []) {
    let pageToken: string | undefined;
    do {
      const page = await walk.api.children(folder, { pageToken, withTrashed: true }, walk.signal);
      for (const file of page.entries) {
        const target = next.shortcuts[file.id];
        if (target !== undefined) {
          next = withShortcut(next, file.id, undefined);
          yield* targetDropped(walk, next, target);
        } else if (file.mimeType !== FOLDER_TYPE) {
          yield { cursor: next, removed: file.id };
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
  }
  // The folder read stays the root of the tree, trashed or not.
  const left = withoutFolders(next, new Set([...gone].filter((folder) => folder !== next.root)));
  yield { cursor: left };
  return left;
}

async function* applyChange(walk: DriveWalk, cursor: DriveCursor, change: DriveChange): Step {
  // A change of a shared drive itself, not of a file.
  if (change.changeType === 'drive') return cursor;
  const file = change.removed === true ? undefined : change.file;
  const id = file?.id ?? change.fileId;
  if (id === undefined) return cursor;
  if (file !== undefined && inTree(cursor, file)) return yield* visit(walk, cursor, file);
  if (Object.hasOwn(cursor.folders, id)) {
    return yield* folderLeft(walk, cursor, id, file !== undefined);
  }
  const target = cursor.shortcuts[id];
  if (target !== undefined) {
    const next = withShortcut(cursor, id, undefined);
    yield* targetDropped(walk, next, target);
    yield { cursor: next };
    return next;
  }
  if (file !== undefined && file.trashed !== true && isShortcutTarget(cursor, id)) {
    return yield* visit(walk, cursor, file);
  }
  // Outside the tree, trashed or deleted. Drive reports every change of the account, so
  // most of these were never read: their removal finds nothing to mark.
  yield { cursor, removed: id };
  return cursor;
}

/**
 * What a Drive folder and its subfolders hold since `stored`: on a first run, or after the
 * configured folder changed, the whole tree, then every change Drive reports. A file
 * trashed, deleted or moved out of the tree is removed; one that changed comes as an item
 * again, with its new checksum.
 */
export async function* driveChanges(
  walk: DriveWalk,
  stored: DriveCursor | undefined,
): AsyncGenerator<SourceChange> {
  let cursor = stored?.folder_id === walk.config.folder_id ? stored : await startCursor(walk);
  if (cursor !== stored) yield { cursor };
  cursor = yield* listPending(walk, cursor);
  for (;;) {
    const page = await walk.api.changes(cursor.page_token, walk.signal);
    for (const change of page.entries) cursor = yield* applyChange(walk, cursor, change);
    // The folders that entered the tree with this page.
    cursor = yield* listPending(walk, cursor);
    const next = page.nextPageToken ?? page.newStartPageToken;
    if (next === undefined) throw new Error('Drive gave no token to resume its changes from.');
    cursor = { ...cursor, page_token: next };
    yield { cursor };
    if (page.nextPageToken === undefined) return;
  }
}
