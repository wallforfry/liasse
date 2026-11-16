import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = new URL('../../../', import.meta.url);

// These run in the process of whoever installs them, so the runtime of the server does not
// bind them: they keep a floor of their own.
const CLIENT_PACKAGES: readonly string[] = ['@liasse/contract', '@liasse/sdk'];

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

const workspaceManifests = async () => Promise.all((await workspaceDirectories()).map(manifestOf));

describe('the Node range', () => {
  it('is the one of the root manifest in every package of the server side', async () => {
    const { engines } = await manifestOf(root);
    const serverSide = (await workspaceManifests()).filter(
      (manifest) => !CLIENT_PACKAGES.includes(manifest.name),
    );
    expect(serverSide.length).toBeGreaterThan(0);
    expect(serverSide.filter((manifest) => manifest.engines.node !== engines.node)).toEqual([]);
  });

  it('is one floor shared by the client packages', async () => {
    const clients = (await workspaceManifests()).filter((manifest) =>
      CLIENT_PACKAGES.includes(manifest.name),
    );
    expect(clients.map((manifest) => manifest.name).toSorted()).toEqual(CLIENT_PACKAGES);
    expect(new Set(clients.map((manifest) => manifest.engines.node)).size).toBe(1);
  });
});
