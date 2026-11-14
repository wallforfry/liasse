import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), 'index.ts');

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
  it('loads nothing but Zod, so a client can use it without the server', async () => {
    const { files, packages } = await walk(ENTRY, { files: new Set(), packages: new Set() });
    expect(files.size).toBeGreaterThan(1);
    expect([...packages]).toEqual(['zod']);
  });
});
