import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isAbortError, TextExtractionError } from '../errors.ts';
import type { PageImage } from '../transcribe.ts';
import type { PdfRendererOptions } from '../types.ts';

const run = promisify(execFile);

export const PDF_RENDER_DPI = 200;
// Scanned pages are photographs, usually stored as JPEG in the PDF already: PNG would
// multiply their size several times, past what vision providers accept for one image,
// without adding anything to read.
const JPEG_QUALITY = 90;
const RENDERED_MIME = 'image/jpeg';
const OWNER_ONLY = 0o600;
const MAX_REPORTED_STDERR = 300;

export interface PdfPageRenderer {
  readonly renderPage: (page: number) => Promise<PageImage>;
}

export interface PdfRenderRequest extends PdfRendererOptions {
  readonly bytes: Uint8Array;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
}

const hasProperty = <K extends string>(value: unknown, key: K): value is Record<K, unknown> =>
  typeof value === 'object' && value !== null && key in value;

const toRenderError = (error: unknown, command: string, timeoutMs: number): unknown => {
  if (isAbortError(error)) return error;
  if (hasProperty(error, 'code') && error.code === 'ENOENT') {
    return new TextExtractionError(
      'pdf_renderer_missing',
      `The command ${command} was not found; install poppler-utils to read scanned PDFs`,
      { cause: error },
    );
  }
  if (hasProperty(error, 'killed') && error.killed === true) {
    return new TextExtractionError(
      'pdf_renderer_timeout',
      `Rendering a PDF page took longer than ${String(timeoutMs)} ms`,
      { cause: error },
    );
  }
  const stderr =
    hasProperty(error, 'stderr') && typeof error.stderr === 'string' ? error.stderr.trim() : '';
  return new TextExtractionError(
    'pdf_renderer_failed',
    `Rendering a PDF page failed${stderr === '' ? '' : `: ${stderr.slice(0, MAX_REPORTED_STDERR)}`}`,
    { cause: error },
  );
};

const renderPage = async (
  directory: string,
  input: string,
  page: number,
  { command, timeoutMs, signal }: PdfRenderRequest,
): Promise<PageImage> => {
  const prefix = join(directory, `page-${String(page)}`);
  const output = `${prefix}.jpg`;
  try {
    await run(
      command,
      [
        '-r',
        String(PDF_RENDER_DPI),
        '-jpeg',
        '-jpegopt',
        `quality=${String(JPEG_QUALITY)}`,
        '-f',
        String(page),
        '-l',
        String(page),
        '-singlefile',
        input,
        prefix,
      ],
      { timeout: timeoutMs, killSignal: 'SIGKILL', ...(signal === undefined ? {} : { signal }) },
    );
    return { image: Uint8Array.from(await readFile(output)), mime: RENDERED_MIME };
  } catch (error) {
    throw toRenderError(error, command, timeoutMs);
  } finally {
    await rm(output, { force: true });
  }
};

// `pdftoppm` reads a file, so the PDF is written to a directory only this user can enter
// (`mkdtemp` creates it with mode 0700), removed whatever happens in `use`.
export const withPdfPageRenderer = async <T>(
  request: PdfRenderRequest,
  use: (renderer: PdfPageRenderer) => Promise<T>,
): Promise<T> => {
  const directory = await mkdtemp(join(request.tempRoot, 'liasse-pdf-'));
  try {
    const input = join(directory, 'input.pdf');
    await writeFile(input, request.bytes, { mode: OWNER_ONLY });
    return await use({ renderPage: (page) => renderPage(directory, input, page, request) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
