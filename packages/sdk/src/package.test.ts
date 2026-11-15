import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const manifestSchema = z.object({ dependencies: z.record(z.string(), z.string()) });

describe('the package', () => {
  it('installs the contract and Zod, nothing of the server', async () => {
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
    );
    expect(Object.keys(manifest.dependencies).toSorted()).toEqual(['@liasse/contract', 'zod']);
  });
});
