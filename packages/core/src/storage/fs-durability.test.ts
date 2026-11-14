import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bytesOf, keyOf } from './contract.test-helper.ts';
import { type DurableFs, nodeDurableFs } from './durable-fs.ts';
import { createFsStorage } from './fs.ts';

// A power loss cannot be staged here. What can be pinned is the order of the calls
// that decide what survives one: the content of a file is synced before the file takes
// its name, and the directory entries are synced after they change and before the
// storage answers. Whether `fsync` itself reaches the disk is the one thing no test
// here can see.
describe('fs storage durability', () => {
  let base: string;
  let calls: string[];

  const recording = (overrides: Partial<DurableFs> = {}): DurableFs => {
    const fs = { ...nodeDurableFs, ...overrides };
    const local = (path: string): string =>
      relative(base, path).replace(/\.[0-9a-f]+\.tmp$/, '.tmp');
    return {
      makeDirectory: async (path) => {
        const created = await fs.makeDirectory(path);
        calls.push(`makeDirectory ${local(path)}`);
        return created;
      },
      writeFile: async (path, bytes) => {
        await fs.writeFile(path, bytes);
        calls.push(`writeFile ${local(path)}`);
      },
      syncFile: async (path) => {
        await fs.syncFile(path);
        calls.push(`syncFile ${local(path)}`);
      },
      rename: async (from, to) => {
        await fs.rename(from, to);
        calls.push(`rename ${local(from)} ${local(to)}`);
      },
      removeFile: async (path) => {
        await fs.removeFile(path);
        calls.push(`removeFile ${local(path)}`);
      },
      syncDirectory: async (path) => {
        await fs.syncDirectory(path);
        calls.push(`syncDirectory ${local(path)}`);
      },
    };
  };

  const syncs = (): readonly string[] => calls.filter((call) => call.startsWith('syncDirectory'));

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'liasse-fs-durability-'));
    calls = [];
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('syncs the content of the file, then its directory and every directory it created', async () => {
    const bytes = bytesOf('synthetic durable file');
    const key = keyOf(bytes);
    const shard = dirname(join('store', key));
    await createFsStorage(join(base, 'store'), recording()).put(key, bytes);
    expect(calls).toEqual([
      `makeDirectory ${shard}`,
      `writeFile ${join('store', key)}.tmp`,
      `syncFile ${join('store', key)}.tmp`,
      `rename ${join('store', key)}.tmp ${join('store', key)}`,
      `syncDirectory ${shard}`,
      `syncDirectory ${dirname(shard)}`,
      'syncDirectory store',
      'syncDirectory ',
    ]);
  });

  it('syncs up to the storage root, and no further, when no directory was created', async () => {
    const first = bytesOf('synthetic first file');
    const shard = dirname(join('store', keyOf(first)));
    const storage = createFsStorage(join(base, 'store'), recording());
    await storage.put(keyOf(first), first);
    calls = [];
    await storage.put(keyOf(first), first);
    expect(syncs()).toEqual([
      `syncDirectory ${shard}`,
      `syncDirectory ${dirname(shard)}`,
      'syncDirectory store',
    ]);
  });

  it('stops at the storage root however the root is written', async () => {
    const bytes = bytesOf('synthetic file under a root with a trailing separator');
    const shard = dirname(join('store', keyOf(bytes)));
    const plain = createFsStorage(join(base, 'store'), recording());
    await plain.put(keyOf(bytes), bytes);
    for (const root of [`${join(base, 'store')}${sep}`, join(base, 'other', '..', 'store')]) {
      calls = [];
      await createFsStorage(root, recording()).put(keyOf(bytes), bytes);
      expect(syncs(), root).toEqual([
        `syncDirectory ${shard}`,
        `syncDirectory ${dirname(shard)}`,
        'syncDirectory store',
      ]);
    }
  });

  it('does not answer before the file and the directories are synced', async () => {
    const bytes = bytesOf('synthetic file that cannot be synced');
    const key = keyOf(bytes);
    const noDirectorySync = recording({
      syncDirectory: () => Promise.reject(new Error('synthetic directory sync failure')),
    });
    await expect(createFsStorage(join(base, 'a'), noDirectorySync).put(key, bytes)).rejects.toThrow(
      'synthetic directory sync failure',
    );
    const noFileSync = recording({
      syncFile: () => Promise.reject(new Error('synthetic file sync failure')),
    });
    const storage = createFsStorage(join(base, 'b'), noFileSync);
    await expect(storage.put(key, bytes)).rejects.toThrow('synthetic file sync failure');
    expect(await storage.exists(key)).toBe(false);
    expect(await readdir(dirname(join(base, 'b', key)))).toEqual([]);
  });

  it('syncs the directory a file was removed from, before the deletion answers', async () => {
    const bytes = bytesOf('synthetic removed file');
    const key = keyOf(bytes);
    const storage = createFsStorage(join(base, 'store'), recording());
    await storage.put(key, bytes);
    calls = [];
    await storage.delete(key);
    expect(calls).toEqual([
      `removeFile ${join('store', key)}`,
      `syncDirectory ${dirname(join('store', key))}`,
    ]);

    const failing = createFsStorage(
      join(base, 'store'),
      recording({ syncDirectory: () => Promise.reject(new Error('synthetic sync failure')) }),
    );
    await storage.put(key, bytes);
    await expect(failing.delete(key)).rejects.toThrow('synthetic sync failure');
  });

  it('deletes an absent file, in a directory that exists or not, without failing', async () => {
    const stored = bytesOf('synthetic neighbour');
    const storage = createFsStorage(join(base, 'store'), recording());
    await storage.put(keyOf(stored), stored);
    await expect(storage.delete(keyOf(stored))).resolves.toBeUndefined();
    await expect(storage.delete(keyOf(stored))).resolves.toBeUndefined();
    await expect(storage.delete(keyOf(bytesOf('synthetic never stored')))).resolves.toBeUndefined();
  });

  it('syncs real files and directories without failing and leaves one file', async () => {
    const bytes = bytesOf('synthetic file on the real file system');
    const key = keyOf(bytes);
    const storage = createFsStorage(join(base, 'store'));
    await storage.put(key, bytes);
    expect(await readdir(dirname(join(base, 'store', key)))).toEqual([
      key.slice(key.lastIndexOf('/') + 1),
    ]);
    await storage.delete(key);
    expect(await readdir(dirname(join(base, 'store', key)))).toEqual([]);
  });
});
