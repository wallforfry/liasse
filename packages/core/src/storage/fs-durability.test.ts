import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bytesOf, keyOf } from './contract.test-helper.ts';
import { type DurableFs, nodeDurableFs } from './durable-fs.ts';
import { createFsStorage } from './fs.ts';

// A power loss cannot be staged here. What can be pinned is the order of the calls
// that decide what survives one: the directory entries of a stored file are synced
// after they exist and before `put` resolves.
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
      rename: async (from, to) => {
        await fs.rename(from, to);
        calls.push(`rename ${local(from)} ${local(to)}`);
      },
      syncDirectory: async (path) => {
        await fs.syncDirectory(path);
        calls.push(`syncDirectory ${local(path)}`);
      },
    };
  };

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'liasse-fs-durability-'));
    calls = [];
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('syncs the directory of the file and the parent of every directory it created', async () => {
    const bytes = bytesOf('synthetic durable file');
    const key = keyOf(bytes);
    const shard = dirname(join('store', key));
    await createFsStorage(join(base, 'store'), recording()).put(key, bytes);
    expect(calls).toEqual([
      `makeDirectory ${shard}`,
      `writeFile ${join('store', key)}.tmp`,
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
    expect(calls.filter((call) => call.startsWith('syncDirectory'))).toEqual([
      `syncDirectory ${shard}`,
      `syncDirectory ${dirname(shard)}`,
      'syncDirectory store',
    ]);
  });

  it('does not resolve before the directories are synced', async () => {
    const bytes = bytesOf('synthetic file whose directory cannot be synced');
    const failing = recording({
      syncDirectory: () => Promise.reject(new Error('synthetic sync failure')),
    });
    await expect(
      createFsStorage(join(base, 'store'), failing).put(keyOf(bytes), bytes),
    ).rejects.toThrow('synthetic sync failure');
  });

  it('syncs real directories without failing and leaves one file', async () => {
    const bytes = bytesOf('synthetic file on the real file system');
    const key = keyOf(bytes);
    await createFsStorage(join(base, 'store')).put(key, bytes);
    expect(await readdir(dirname(join(base, 'store', key)))).toEqual([
      key.slice(key.lastIndexOf('/') + 1),
    ]);
  });
});
