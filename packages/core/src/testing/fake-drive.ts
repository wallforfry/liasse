import { createHash, randomUUID } from 'node:crypto';

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

interface StoredFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly parents: readonly string[];
  readonly trashed: boolean;
  readonly bytes?: Uint8Array;
  readonly target?: string;
  /** What a request of the file answers instead of its bytes or its metadata. */
  readonly refusal?: DriveRefusal;
}

/** A refusal, as Drive answers one: a status and the reason of its body. */
export interface DriveRefusal {
  readonly status: number;
  readonly reason: string;
  /** The request refused: the download of the bytes (the default), or the metadata. */
  readonly of?: 'download' | 'metadata';
}

/** The files of a Drive as the fake serves them, and a change log of every edit. */
export interface FakeDriveState {
  /** The id of the top of My Drive, which `root` stands for. */
  readonly rootId: string;
  readonly folder: (name: string, parent?: string) => string;
  /** A binary file, listed as `application/pdf` unless another type is given. */
  readonly file: (name: string, parent: string, bytes: Uint8Array, mimeType?: string) => string;
  /** A Google Doc: a type of Google's own, without bytes. */
  readonly googleDoc: (name: string, parent: string) => string;
  readonly shortcut: (name: string, parent: string, target: string) => string;
  readonly update: (id: string, bytes: Uint8Array) => void;
  /** Every later request of the file answers this refusal; listings of its folder do not. */
  readonly refuse: (id: string, refusal: DriveRefusal) => void;
  readonly trash: (id: string) => void;
  readonly restore: (id: string) => void;
  readonly move: (id: string, parent: string) => void;
  /** Deleted for good: the change log reports it as removed. */
  readonly remove: (id: string) => void;
  readonly get: (id: string) => StoredFile | undefined;
  readonly children: (parent: string, withTrashed: boolean) => readonly StoredFile[];
  readonly changesSince: (position: number) => readonly { readonly fileId: string }[];
  readonly position: () => number;
}

export const md5Of = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('hex');

export const fileResource = (file: StoredFile) => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  parents: file.parents,
  trashed: file.trashed,
  ...(file.bytes === undefined
    ? {}
    : { md5Checksum: md5Of(file.bytes), size: String(file.bytes.byteLength) }),
  ...(file.target === undefined ? {} : { shortcutDetails: { targetId: file.target } }),
});

export const createFakeDriveState = (): FakeDriveState => {
  const files = new Map<string, StoredFile>();
  const log: { readonly fileId: string }[] = [];
  const rootId = `root-${randomUUID()}`;
  files.set(rootId, {
    id: rootId,
    name: 'My Drive',
    mimeType: FOLDER,
    parents: [],
    trashed: false,
  });
  const write = (file: StoredFile): string => {
    files.set(file.id, file);
    log.push({ fileId: file.id });
    return file.id;
  };
  const edit = (id: string, change: Partial<StoredFile>): void => {
    const file = files.get(id);
    if (file === undefined) throw new Error(`The fake Drive has no file ${id}`);
    write({ ...file, ...change });
  };
  const add = (name: string, mimeType: string, parent: string, extra: Partial<StoredFile> = {}) =>
    write({
      id: `f${randomUUID().replaceAll('-', '')}`,
      name,
      mimeType,
      parents: [parent],
      trashed: false,
      ...extra,
    });
  return {
    rootId,
    folder: (name, parent = rootId) => add(name, FOLDER, parent),
    file: (name, parent, bytes, mimeType = 'application/pdf') =>
      add(name, mimeType, parent, { bytes }),
    googleDoc: (name, parent) => add(name, 'application/vnd.google-apps.document', parent),
    shortcut: (name, parent, target) => add(name, SHORTCUT, parent, { target }),
    update: (id, bytes) => {
      edit(id, { bytes });
    },
    refuse: (id, refusal) => {
      const file = files.get(id);
      if (file === undefined) throw new Error(`The fake Drive has no file ${id}`);
      files.set(id, { ...file, refusal });
    },
    trash: (id) => {
      edit(id, { trashed: true });
    },
    restore: (id) => {
      edit(id, { trashed: false });
    },
    move: (id, parent) => {
      edit(id, { parents: [parent] });
    },
    remove: (id) => {
      files.delete(id);
      log.push({ fileId: id });
    },
    get: (id) => files.get(id === 'root' ? rootId : id),
    children: (parent, withTrashed) =>
      [...files.values()].filter(
        (file) => file.parents.includes(parent) && (withTrashed || !file.trashed),
      ),
    changesSince: (position) => log.slice(position),
    position: () => log.length,
  };
};
