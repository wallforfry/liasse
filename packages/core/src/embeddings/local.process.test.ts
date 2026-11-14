import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

// ONNX Runtime is a native addon, so the shared objects of the process tell whether it was
// loaded. Only a fresh process gives a trustworthy answer.
const SCRIPT = `
  const { createLocalEmbedder } = await import(process.argv[1]);
  createLocalEmbedder({ dimension: 384, cacheDir: '/synthetic/models' });
  const loaded = process.report.getReport().sharedObjects.some((path) => /onnxruntime/i.test(path));
  process.stdout.write(JSON.stringify({ onnxRuntimeLoaded: loaded }));
`;

describe('an idle local embedder', () => {
  it('does not load ONNX Runtime', async () => {
    const { stdout } = await run(process.execPath, [
      '--conditions=@liasse/source',
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      SCRIPT,
      fileURLToPath(new URL('./local.ts', import.meta.url)),
    ]);
    expect(JSON.parse(stdout)).toEqual({ onnxRuntimeLoaded: false });
  });
});
