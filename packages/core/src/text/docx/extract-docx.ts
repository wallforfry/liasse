import { DOCX_MAIN_DOCUMENT } from '../../formats/docx.ts';
import { TextExtractionError } from '../errors.ts';
import { normalizeText } from '../normalize.ts';
import { toExtractedText } from '../result.ts';
import type { ExtractedText, ExtractionContext } from '../types.ts';
import { renderDocxMarkdown } from './markdown.ts';
import { parseXml } from './xml.ts';
import { readZipEntry } from './zip.ts';

// Apart from explicit breaks, a DOCX stores no page boundary: pagination is decided by the
// application that lays the document out, so page numbers derived here would not match
// what a reader sees. The whole document is one logical page.
export const extractDocx = async (
  bytes: Uint8Array,
  { limits }: ExtractionContext,
): Promise<ExtractedText> => {
  const xml = await readZipEntry(bytes, DOCX_MAIN_DOCUMENT, limits.maxDocxXmlBytes);
  if (xml === undefined) {
    throw new TextExtractionError('docx_corrupt', `The archive holds no ${DOCX_MAIN_DOCUMENT}`);
  }
  const document = parseXml(new TextDecoder().decode(xml), {
    maxNodes: limits.maxDocxXmlNodes,
    maxTextChars: limits.maxDocxTextChars,
  });
  const markdown = renderDocxMarkdown(document);
  if (markdown === undefined) {
    throw new TextExtractionError('docx_corrupt', `${DOCX_MAIN_DOCUMENT} has no document body`);
  }
  return toExtractedText([{ text: normalizeText(markdown) }]);
};
