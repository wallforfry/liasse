import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
  exports: z.record(z.string(), z.object({ '@liasse/source': z.string() })),
});

const readManifest = async () =>
  manifestSchema.parse(JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')));

// Every `from '…'`, bare `import '…'` and dynamic `import('…')`, in either quotes and
// type-only ones included: a declaration file that names a module needs it installed as
// much as the code does.
const SPECIFIER = /(?:\bfrom\s+|^import\s+|\bimport\s*\(\s*)(['"])([^'"]+)\1/gm;

const specifiersOf = async (file: string): Promise<readonly string[]> =>
  [...(await readFile(file, 'utf8')).matchAll(SPECIFIER)].flatMap(([, , specifier]) =>
    specifier === undefined ? [] : [specifier],
  );

interface Graph {
  readonly files: ReadonlySet<string>;
  readonly packages: ReadonlySet<string>;
}

const walk = async (file: string, graph: Graph): Promise<Graph> => {
  if (graph.files.has(file)) return graph;
  const specifiers = await specifiersOf(file);
  const local = specifiers.filter((specifier) => specifier.startsWith('.'));
  const start: Graph = {
    files: new Set([...graph.files, file]),
    packages: new Set([...graph.packages, ...specifiers.filter((s) => !s.startsWith('.'))]),
  };
  let next = start;
  for (const specifier of local) next = await walk(resolve(dirname(file), specifier), next);
  return next;
};

describe('the contract', () => {
  it('loads nothing but Zod from any entry, so a client can use it without the server', async () => {
    const { exports } = await readManifest();
    const entries = Object.values(exports).map((entry) =>
      resolve(PACKAGE_ROOT, entry['@liasse/source']),
    );
    expect(entries.length).toBeGreaterThan(1);
    let graph: Graph = { files: new Set(), packages: new Set() };
    for (const entry of entries) graph = await walk(entry, graph);
    expect(graph.files.size).toBeGreaterThan(entries.length);
    expect([...graph.packages]).toEqual(['zod']);
  });

  it('depends on Zod alone', async () => {
    const { dependencies } = await readManifest();
    expect(Object.keys(dependencies)).toEqual(['zod']);
  });
});
