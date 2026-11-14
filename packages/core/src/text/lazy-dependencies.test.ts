import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Loaded at the first document that needs them, so that an idle server does not pay for
// them in memory.
const HEAVY_PACKAGES = ['pdfjs-dist', 'heic-decode', 'jpeg-js', 'postal-mime'];

const STATIC_VALUE_IMPORT = new RegExp(
  `^(?:import|export)\\s+(?!type\\b)[^;]*?from\\s+'(?:${HEAVY_PACKAGES.join('|')})[^']*'`,
  'm',
);

describe('the heavy dependencies of text extraction', () => {
  it('are only imported dynamically or for their types', async () => {
    const directory = fileURLToPath(new URL('.', import.meta.url));
    const sources = (await readdir(directory, { recursive: true })).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    const offenders = await Promise.all(
      sources.map(async (file) =>
        STATIC_VALUE_IMPORT.test(await readFile(`${directory}/${file}`, 'utf8')) ? [file] : [],
      ),
    );
    expect(sources.length).toBeGreaterThan(10);
    expect(offenders.flat()).toEqual([]);
  });
});
