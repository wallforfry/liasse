import { link, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFsStorage } from './fs.ts';
import { bytesOf, describeStorageContract, keyOf } from './contract.test-helper.ts';

describeStorageContract('fs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liasse-fs-contract-'));
  return {
    storage: createFsStorage(root),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
});

describe('fs storage', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'liasse-fs-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('shards files under two directory levels taken from the hash', async () => {
    const bytes = bytesOf('synthetic sharded file');
    const key = keyOf(bytes);
    await createFsStorage(root).put(key, bytes);
    const [first, second, name] = key.split('/');
    expect(name).toMatch(/^[0-9a-f]{64}$/);
    expect(name?.startsWith(`${first ?? ''}${second ?? ''}`)).toBe(true);
    expect(await readFile(join(root, first ?? '', second ?? '', name ?? ''), 'utf8')).toBe(
      'synthetic sharded file',
    );
  });

  it('creates a storage root that does not exist yet', async () => {
    const bytes = bytesOf('synthetic file under a new root');
    const storage = createFsStorage(join(root, 'not', 'created', 'yet'));
    await storage.put(keyOf(bytes), bytes);
    expect(await storage.exists(keyOf(bytes))).toBe(true);
  });

  it('replaces a file by rename, never by writing into it', async () => {
    const storage = createFsStorage(root);
    const key = keyOf(bytesOf('synthetic replaced file'));
    await storage.put(key, bytesOf('first content'));
    // A hard link keeps the first inode readable: writing in place would change it too.
    const witness = join(root, 'witness');
    await link(join(root, key), witness);
    await storage.put(key, bytesOf('second content'));
    expect(await readFile(witness, 'utf8')).toBe('first content');
    expect(new TextDecoder().decode(await storage.get(key))).toBe('second content');
  });

  it('leaves no temporary file behind', async () => {
    const storage = createFsStorage(root);
    const bytes = bytesOf('synthetic file without leftovers');
    const key = keyOf(bytes);
    await Promise.all(Array.from({ length: 8 }, () => storage.put(key, bytes)));
    const siblings = await readdir(join(root, key, '..'));
    expect(siblings).toEqual([key.slice(key.lastIndexOf('/') + 1)]);
  });

  it('does not take a directory for a stored file', async () => {
    const key = keyOf(bytesOf('synthetic directory in place of a file'));
    await mkdir(join(root, key), { recursive: true });
    expect(await createFsStorage(root).exists(key)).toBe(false);
  });
});
