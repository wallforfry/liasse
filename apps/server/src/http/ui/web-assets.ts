import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { StartupError } from '@liasse/core/domain';
import { getMimeType } from 'hono/utils/mime';

export const INDEX_FILE = 'index.html';
// Where Vite writes the files it names by their content hash.
const HASHED_DIRECTORY = 'assets/';
const FALLBACK_TYPE = 'application/octet-stream';

export interface WebAsset {
  readonly body: Uint8Array<ArrayBuffer>;
  readonly type: string;
  /** Named by its content hash: a new build gives it a new name. */
  readonly immutable: boolean;
}

/** The build of `@liasse/web`, read once at startup. */
export interface WebAssets {
  /** `index.html`, served for every route of the application. */
  readonly index: string;
  /** Every other file, by its path under the build, with `/` as separator. */
  readonly files: ReadonlyMap<string, WebAsset>;
}

const missingBuild = (directory: string, reason: string): StartupError =>
  new StartupError(`The build of the web UI ${reason} at ${directory}. Run \`pnpm build\` first.`);

/** The `dist` directory of the installed `@liasse/web` package. */
export const resolveWebAssetsDirectory = (
  /** Node's resolution from this module by default; a test resolves nothing. */
  resolve: (specifier: string) => string = createRequire(import.meta.url).resolve,
): string => {
  try {
    const manifest = resolve('@liasse/web/package.json');
    return join(dirname(manifest), 'dist');
  } catch {
    throw new StartupError(
      'The web UI is missing: @liasse/web is not installed. Install the workspace.',
    );
  }
};

const assetOf = async (directory: string, path: string): Promise<[string, WebAsset]> => {
  const name = relative(directory, path).split(sep).join('/');
  return [
    name,
    {
      body: new Uint8Array(await readFile(path)),
      type: getMimeType(name) ?? FALLBACK_TYPE,
      immutable: name.startsWith(HASHED_DIRECTORY),
    },
  ];
};

/** Reads the build of the web UI; a StartupError when there is none. */
export const loadWebAssets = async (directory: string): Promise<WebAssets> => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => {
    throw missingBuild(directory, 'was not found');
  });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => assetOf(directory, join(entry.parentPath, entry.name))),
  );
  const assets = new Map(files);
  const index = assets.get(INDEX_FILE);
  if (index === undefined) throw missingBuild(directory, `has no ${INDEX_FILE}`);
  const html = new TextDecoder().decode(index.body);
  if (!html.includes('<head>'))
    throw missingBuild(directory, `has an ${INDEX_FILE} without <head>`);
  assets.delete(INDEX_FILE);
  return { index: html, files: assets };
};
