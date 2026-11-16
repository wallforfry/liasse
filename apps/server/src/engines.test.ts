import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = new URL('../../../', import.meta.url);

const manifestSchema = z.object({
  name: z.string(),
  engines: z.object({ node: z.string() }),
});

const manifestOf = async (directory: URL) =>
  manifestSchema.parse(JSON.parse(await readFile(new URL('package.json', directory), 'utf8')));

const workspaceDirectories = async (): Promise<readonly URL[]> => {
  const nested = await Promise.all(
    ['apps/', 'packages/'].map(async (parent) =>
      (await readdir(new URL(parent, root), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => new URL(`${parent}${entry.name}/`, root)),
    ),
  );
  return [...nested.flat(), new URL('eval/', root)];
};

describe('the Node range', () => {
  it('is the one of the root manifest in every workspace package', async () => {
    const { engines } = await manifestOf(root);
    const manifests = await Promise.all((await workspaceDirectories()).map(manifestOf));
    expect(manifests.length).toBeGreaterThan(0);
    expect(manifests.filter((manifest) => manifest.engines.node !== engines.node)).toEqual([]);
  });
});
