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

const POINTS_PER_INCH = 72;

export interface PdfPageToRender {
  readonly number: number;
  readonly longEdgePt: number;
}

export interface PdfPageRenderer {
  readonly renderPage: (page: PdfPageToRender) => Promise<PageImage>;
}

export interface PdfRenderRequest extends PdfRendererOptions {
  readonly bytes: Uint8Array;
  readonly timeoutMs: number;
  readonly maxEdgePx: number;
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

// 200 dpi while the page fits the pixel budget. A larger page is scaled so that its long
// edge is the budget: the memory `pdftoppm` needs grows with the raster, and a page of a
// few hundred bytes can declare any size.
const resolutionArguments = (longEdgePt: number, maxEdgePx: number): readonly string[] =>
  (longEdgePt * PDF_RENDER_DPI) / POINTS_PER_INCH > maxEdgePx
    ? ['-scale-to', String(maxEdgePx)]
    : ['-r', String(PDF_RENDER_DPI)];

const readRenderedPage = async (output: string, command: string): Promise<Uint8Array> => {
  try {
    return Uint8Array.from(await readFile(output));
  } catch (error) {
    throw new TextExtractionError(
      'pdf_renderer_no_output',
      `The command ${command} exited without writing the page it was asked for`,
      { cause: error },
    );
  }
};

const renderPage = async (
  directory: string,
  input: string,
  { number, longEdgePt }: PdfPageToRender,
  { command, timeoutMs, signal, maxEdgePx }: PdfRenderRequest,
): Promise<PageImage> => {
  const prefix = join(directory, `page-${String(number)}`);
  const output = `${prefix}.jpg`;
  const args = [
    ...resolutionArguments(longEdgePt, maxEdgePx),
    // pdfjs measures the visible box of a page; without this flag `pdftoppm` renders the
    // media box, which can be far larger than the size the resolution was chosen for.
    '-cropbox',
    '-jpeg',
    '-jpegopt',
    `quality=${String(JPEG_QUALITY)}`,
    '-f',
    String(number),
    '-l',
    String(number),
    '-singlefile',
    input,
    prefix,
  ];
  const options = {
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    ...(signal === undefined ? {} : { signal }),
  } as const;
  try {
    await run(command, args, options).catch((error: unknown) => {
      throw toRenderError(error, command, timeoutMs);
    });
    return { image: await readRenderedPage(output, command), mime: RENDERED_MIME };
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
