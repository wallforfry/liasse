import { tmpdir } from 'node:os';
import { extractDocx } from './docx/extract-docx.ts';
import { extractEml } from './eml/extract-eml.ts';
import { TextExtractionError } from './errors.ts';
import { extractImage } from './image/extract-image.ts';
import { resolveTextLimits } from './limits.ts';
import { extractPdf } from './pdf/extract-pdf.ts';
import type { ExtractedText, ExtractTextDeps, ExtractTextInput } from './types.ts';

const DEFAULT_PDFTOPPM_COMMAND = 'pdftoppm';

// The parameter is `never` when every supported type has its case, so a type added to the
// domain list without one stops compiling; at run time it catches a value that was
// asserted rather than validated.
const refuseMime = (mime: never): never => {
  throw new TextExtractionError(
    'unsupported_mime',
    `Text extraction does not support the MIME type ${JSON.stringify(mime)}`,
  );
};

// Turns the bytes of a document into text, page by page. It reads and writes nothing
// besides a private temporary directory for scanned PDFs, and calls the vision model only
// for content without a usable text layer.
export const extractText = async (
  { bytes, mime }: ExtractTextInput,
  deps: ExtractTextDeps,
): Promise<ExtractedText> => {
  deps.signal?.throwIfAborted();
  const context = {
    vision: deps.vision,
    signal: deps.signal,
    limits: resolveTextLimits(deps.limits),
    pdfRenderer: { command: DEFAULT_PDFTOPPM_COMMAND, tempRoot: tmpdir(), ...deps.pdfRenderer },
  };
  switch (mime) {
    case 'application/pdf':
      return extractPdf(bytes, context);
    case 'image/jpeg':
    case 'image/png':
    case 'image/heic':
      return extractImage(bytes, mime, context);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractDocx(bytes, context);
    case 'message/rfc822':
      return extractEml(bytes);
    default:
      return refuseMime(mime);
  }
};
