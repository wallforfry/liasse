import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TextExtractionError } from '../errors.ts';
import type { PageImage } from '../transcribe.ts';
import type { PdfRendererOptions } from '../types.ts';
import { readJpegSize } from './jpeg-size.ts';
import { measurePage, type PageMeasure } from './page-size.ts';
import { runPoppler, type PopplerRunOptions } from './poppler.ts';

export const PDF_RENDER_DPI = 200;
// Scanned pages are photographs, usually stored as JPEG in the PDF already: PNG would
// multiply their size several times, past what vision providers accept for one image,
// without adding anything to read.
const JPEG_QUALITY = 90;
const RENDERED_MIME = 'image/jpeg';
const OWNER_ONLY = 0o600;
const POINTS_PER_INCH = 72;

// `-scale-to` rounds each edge on its own and can exceed the edge it was given by a pixel
// on the other one: a square page of 1191 points comes out 3309 x 3308.
const SCALE_ROUNDING_PX = 2;

export interface PdfPageRenderer {
  // `undefined` for a page that has no area to render.
  readonly renderPage: (page: number) => Promise<PageImage | undefined>;
}

export interface PdfRenderRequest extends PdfRendererOptions, PopplerRunOptions {
  readonly bytes: Uint8Array;
  readonly maxEdgePx: number;
}

// 200 dpi while the page fits the pixel budget. A larger page is scaled so that its long
// edge is the budget: the memory `pdftoppm` needs grows with the raster, and a page of a
// few hundred bytes can declare any size. `-scale-to` would also enlarge a small page,
// hence the choice between the two. A size that cannot be trusted is scaled as well:
// that render is bounded whatever the page is.
const resolutionArguments = (measure: PageMeasure, maxEdgePx: number): readonly string[] =>
  measure.kind === 'sized' && (measure.longEdgePt * PDF_RENDER_DPI) / POINTS_PER_INCH <= maxEdgePx
    ? ['-r', String(PDF_RENDER_DPI)]
    : ['-scale-to', String(maxEdgePx)];

// What came out is checked whatever was asked for: a file that is no image, or one larger
// than the budget, never reaches the vision model.
const readRenderedPage = async (
  output: string,
  { command, maxEdgePx }: PdfRenderRequest,
): Promise<Uint8Array> => {
  const image = await readFile(output).catch(() => new Uint8Array(0));
  const size = readJpegSize(image);
  if (size === undefined) {
    throw new TextExtractionError(
      'pdf_renderer_no_output',
      `The command ${command} exited without writing the image of the page it was asked for`,
    );
  }
  if (Math.max(size.width, size.height) > maxEdgePx + SCALE_ROUNDING_PX) {
    throw new TextExtractionError(
      'pdf_page_unrenderable',
      `The command ${command} rendered a page of ${String(size.width)}x${String(size.height)} pixels, more than the limit of ${String(maxEdgePx)} on its long edge`,
    );
  }
  return Uint8Array.from(image);
};

const renderPage = async (
  directory: string,
  input: string,
  page: number,
  request: PdfRenderRequest,
): Promise<PageImage | undefined> => {
  const prefix = join(directory, `page-${String(page)}`);
  const output = `${prefix}.jpg`;
  const measure = await measurePage(request.infoCommand, input, page, request);
  if (measure.kind === 'degenerate') return undefined;
  const args = [
    ...resolutionArguments(measure, request.maxEdgePx),
    // The size was read from the crop box, which is what a reader shows; `pdftoppm`
    // renders the media box unless told otherwise.
    '-cropbox',
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
  ];
  try {
    await runPoppler(request.command, args, request);
    return { image: await readRenderedPage(output, request), mime: RENDERED_MIME };
  } finally {
    await rm(output, { force: true });
  }
};

// poppler reads a file, so the PDF is written to a directory only this user can enter
// (`mkdtemp` creates it with mode 0700), removed whatever happens in `use`. Only a process
// killed in the middle of an extraction leaves one behind.
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
