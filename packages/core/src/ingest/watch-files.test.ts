import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isIgnoredName, listWatchedFiles } from './watch-files.ts';

describe('listWatchedFiles', () => {
  let dir: string;
  const locked = (): string => join(dir, 'lost+found');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'liasse-watch-files-'));
  });

  afterEach(async () => {
    await chmod(locked(), 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('lists regular files at any depth', async () => {
    await mkdir(join(dir, 'a', 'b'), { recursive: true });
    await writeFile(join(dir, 'top.pdf'), 'top');
    await writeFile(join(dir, 'a', 'b', 'deep.pdf'), 'deep');
    const listing = await listWatchedFiles(dir);
    expect([...listing.files].sort()).toEqual([
      join(dir, 'a', 'b', 'deep.pdf'),
      join(dir, 'top.pdf'),
    ]);
    expect(listing.unreadable).toEqual([]);
  });

  it('skips a directory it cannot read and still lists what is beside and below', async () => {
    await mkdir(locked());
    await writeFile(join(locked(), 'hidden.pdf'), 'hidden');
    await mkdir(join(dir, 'readable'));
    await writeFile(join(dir, 'bill.pdf'), 'bill');
    await writeFile(join(dir, 'readable', 'scan.pdf'), 'scan');
    await chmod(locked(), 0o000);
    const listing = await listWatchedFiles(dir);
    expect([...listing.files].sort()).toEqual([
      join(dir, 'bill.pdf'),
      join(dir, 'readable', 'scan.pdf'),
    ]);
    expect(listing.unreadable).toMatchObject([{ path: locked(), error: { code: 'EACCES' } }]);
  });

  it('does not enter a hidden directory, readable or not', async () => {
    await mkdir(join(dir, '.trash'));
    await writeFile(join(dir, '.trash', 'old.pdf'), 'old');
    await chmod(join(dir, '.trash'), 0o000);
    try {
      expect(await listWatchedFiles(dir)).toEqual({ files: [], unreadable: [] });
    } finally {
      await chmod(join(dir, '.trash'), 0o700);
    }
  });

  it('neither lists nor follows symbolic links', async () => {
    await mkdir(join(dir, 'real'));
    await writeFile(join(dir, 'real', 'file.pdf'), 'file');
    await symlink(join(dir, 'real', 'file.pdf'), join(dir, 'link-to-file.pdf'));
    await symlink(join(dir, 'real'), join(dir, 'link-to-directory'));
    await symlink(dir, join(dir, 'real', 'loop'));
    expect((await listWatchedFiles(dir)).files).toEqual([join(dir, 'real', 'file.pdf')]);
  });

  it('rejects when the watched directory itself cannot be read', async () => {
    await expect(listWatchedFiles(join(dir, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('isIgnoredName', () => {
  it.each([
    ['.hidden', true],
    ['.DS_Store', true],
    ['file.pdf.part', true],
    ['File.CRDOWNLOAD', true],
    ['backup.pdf~', true],
    ['~$letter.docx', true],
    ['file.pdf', false],
    ['file.name.pdf', false],
    ['temporary.pdf', false],
    ['lost+found', false],
  ])('answers for %s: %s', (name, ignored) => {
    expect(isIgnoredName(name)).toBe(ignored);
  });
});
