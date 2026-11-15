import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StartupError } from '@liasse/core/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWebAssets, resolveWebAssetsDirectory } from './web-assets.ts';

describe('loadWebAssets', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'liasse-web-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads the page and every file of the build, marking the hashed ones', async () => {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), '<html><head></head><body></body></html>');
    await writeFile(join(directory, 'assets', 'index-a1b2.js'), 'export {};');
    await writeFile(join(directory, 'favicon.svg'), '<svg/>');
    const assets = await loadWebAssets(directory);
    expect(assets.index).toBe('<html><head></head><body></body></html>');
    expect([...assets.files.keys()].toSorted()).toEqual(['assets/index-a1b2.js', 'favicon.svg']);
    expect(assets.files.get('assets/index-a1b2.js')).toMatchObject({
      type: 'text/javascript; charset=utf-8',
      immutable: true,
    });
    expect(assets.files.get('favicon.svg')).toMatchObject({
      type: 'image/svg+xml; charset=utf-8',
      immutable: false,
    });
  });

  it('refuses to start without a build, saying what to do', async () => {
    const missing = join(directory, 'dist');
    const error: unknown = await loadWebAssets(missing).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StartupError);
    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('pnpm build');
    expect(message).toContain(missing);
  });

  it('finds the build in the installed @liasse/web package', () => {
    const webPackage = fileURLToPath(new URL('../../../../web/', import.meta.url));
    expect(resolveWebAssetsDirectory()).toBe(join(webPackage, 'dist'));
  });

  it('refuses to start when @liasse/web is not installed', () => {
    const missing = (specifier: string): string => {
      throw new Error(`Cannot find module '${specifier}'`);
    };
    expect(() => resolveWebAssetsDirectory(missing)).toThrow(StartupError);
    expect(() => resolveWebAssetsDirectory(missing)).toThrow(/@liasse\/web is not installed/);
  });

  it('refuses a build without its page', async () => {
    await writeFile(join(directory, 'favicon.svg'), '<svg/>');
    await expect(loadWebAssets(directory)).rejects.toBeInstanceOf(StartupError);
  });
});
