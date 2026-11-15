import type { SupportedMime } from '@liasse/contract/domain';
import { buildSyntheticDocx, buildSyntheticPdf, type SyntheticPdfPage } from '@liasse/core/testing';
import type { PageTruth } from '../schema/index.ts';
import type { PageSpec, RenderSpec, ScenarioDocument } from '../scenario/model.ts';
import { buildEml } from './eml.ts';
import { encodeJpeg } from './jpeg.ts';
import { PAPERS, type PaperName, paperStyle } from './paper.ts';
import { encodeBilevelPng } from './png.ts';
import { type GrayImage, renderPage } from './raster.ts';

export interface RenderedDocument {
  readonly bytes: Uint8Array;
  readonly mime: SupportedMime;
  readonly extension: string;
  readonly pages: readonly PageTruth[];
}

export interface RenderContext {
  // The documents rendered so far, by id: an email attaches them, a copy repeats them.
  readonly rendered: ReadonlyMap<string, RenderedDocument>;
  // The HEIC files, by document id. Node has no HEIC encoder, so they are not rendered
  // here: a platform tool encodes the picture of `heicSource` once, and the result is kept.
  readonly heic: ReadonlyMap<string, Uint8Array>;
}

export class RenderError extends Error {
  override readonly name = 'RenderError';
}

const A4_WIDTH_PT = 595;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const pageText = (lines: readonly string[]): string => lines.join('\n').trimEnd();

const draw = (
  id: string,
  lines: readonly string[],
  paper: PaperName,
  page: number,
  stamp?: string,
): GrayImage =>
  renderPage(lines, paperStyle(paper, lines.length), `${id}/page-${String(page)}`, stamp);

const scannedPage = (
  id: string,
  lines: readonly string[],
  paper: PaperName,
  page: number,
  stamp?: string,
) => {
  const image = draw(id, lines, paper, page, stamp);
  return {
    jpeg: {
      bytes: encodeJpeg(image, PAPERS[paper].jpegQuality),
      widthPx: image.width,
      heightPx: image.height,
    },
    widthPt: A4_WIDTH_PT,
    heightPt: Math.round((A4_WIDTH_PT * image.height) / image.width),
  };
};

const pdfPage = (id: string, { lines, scan, stamp }: PageSpec, index: number): SyntheticPdfPage =>
  scan === undefined ? { lines } : scannedPage(id, lines, scan, index + 1, stamp);

const renderPdf = (id: string, pages: readonly PageSpec[]): RenderedDocument => ({
  bytes: buildSyntheticPdf(pages.map((page, index) => pdfPage(id, page, index))),
  mime: 'application/pdf',
  extension: 'pdf',
  pages: pages.map(({ lines, scan, stamp }, index) => ({
    page: index + 1,
    method: scan === undefined ? 'native' : 'vision',
    // A stamp is on the page like the rest: a faithful transcription has its words.
    text: pageText(scan === undefined || stamp === undefined ? lines : [...lines, '', stamp]),
  })),
});

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const renderDocx = (lines: readonly string[]): RenderedDocument => ({
  bytes: buildSyntheticDocx(
    lines
      .filter((line) => line !== '')
      .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
      .join(''),
    { stored: true },
  ),
  mime: DOCX,
  extension: 'docx',
  pages: [{ page: 1, method: 'native', text: pageText(lines) }],
});

// The picture a HEIC document is encoded from, and compared with once decoded.
export const heicSource = ({ id, render }: ScenarioDocument): GrayImage => {
  if (render.kind !== 'image' || render.encoding !== 'heic') {
    throw new RenderError(`The document "${id}" is not a HEIC picture`);
  }
  return draw(id, render.lines, render.paper, 1);
};

const renderImage = (
  id: string,
  render: Extract<RenderSpec, { kind: 'image' }>,
  { heic }: RenderContext,
): RenderedDocument => {
  const pages: readonly PageTruth[] = [{ page: 1, method: 'vision', text: pageText(render.lines) }];
  if (render.encoding === 'heic') {
    const bytes = heic.get(id);
    if (bytes === undefined) {
      throw new RenderError(
        `No HEIC file was given for "${id}": encode its source picture first (see the README of the evaluation set)`,
      );
    }
    return { bytes, mime: 'image/heic', extension: 'heic', pages };
  }
  const image = draw(id, render.lines, render.paper, 1);
  return render.encoding === 'png'
    ? { bytes: encodeBilevelPng(image), mime: 'image/png', extension: 'png', pages }
    : {
        bytes: encodeJpeg(image, PAPERS[render.paper].jpegQuality),
        mime: 'image/jpeg',
        extension: 'jpg',
        pages,
      };
};

const renderedBefore = (id: string, wanted: string, { rendered }: RenderContext) => {
  const found = rendered.get(wanted);
  if (found === undefined) {
    throw new RenderError(
      `The document "${id}" needs "${wanted}", which must come before it in the scenario`,
    );
  }
  return found;
};

const renderEml = (
  id: string,
  render: Extract<RenderSpec, { kind: 'eml' }>,
  context: RenderContext,
): RenderedDocument => ({
  bytes: buildEml({
    id,
    from: render.from,
    to: render.to,
    date: render.date,
    subject: render.subject,
    lines: render.lines,
    attachments: render.attachments.map(({ filename, document }) => {
      const { bytes, mime } = renderedBefore(id, document, context);
      return { filename, mime, bytes };
    }),
  }),
  mime: 'message/rfc822',
  extension: 'eml',
  pages: [
    {
      page: 1,
      method: 'native',
      text: pageText([`Subject: ${render.subject}`, '', ...render.lines]),
    },
  ],
});

export const renderDocument = (
  document: ScenarioDocument,
  context: RenderContext,
): RenderedDocument => {
  const { id, render } = document;
  switch (render.kind) {
    case 'pdf':
      return renderPdf(id, render.pages);
    case 'docx':
      return renderDocx(render.lines);
    case 'image':
      return renderImage(id, render, context);
    case 'eml':
      return renderEml(id, render, context);
    case 'copy':
      return renderedBefore(id, render.of, context);
  }
};
