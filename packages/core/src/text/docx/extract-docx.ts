import { TextExtractionError } from '../errors.ts';
import { normalizeText } from '../normalize.ts';
import type { ExtractedText, ExtractionContext } from '../types.ts';
import { renderDocxMarkdown } from './markdown.ts';
import { parseXml } from './xml.ts';
import { readZipEntry } from './zip.ts';

const MAIN_DOCUMENT = 'word/document.xml';

// Apart from explicit breaks, a DOCX stores no page boundary: pagination is decided by the
// application that lays the document out, so page numbers derived here would not match
// what a reader sees. The whole document is one logical page.
export const extractDocx = async (
  bytes: Uint8Array,
  { limits }: ExtractionContext,
): Promise<ExtractedText> => {
  const xml = await readZipEntry(bytes, MAIN_DOCUMENT, limits.maxDocxXmlBytes);
  if (xml === undefined) {
    throw new TextExtractionError('docx_corrupt', `The archive holds no ${MAIN_DOCUMENT}`);
  }
  const document = parseXml(new TextDecoder().decode(xml), limits.maxDocxXmlNodes);
  const markdown = renderDocxMarkdown(document);
  if (markdown === undefined) {
    throw new TextExtractionError('docx_corrupt', `${MAIN_DOCUMENT} has no document body`);
  }
  return { pages: [{ page: 1, text: normalizeText(markdown) }], method: 'native', attachments: [] };
};
